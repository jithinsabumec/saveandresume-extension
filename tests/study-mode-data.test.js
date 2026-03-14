const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function loadDataLayer(fetchImpl = async () => {
    throw new Error('fetch stub was not provided');
}) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'data-layer.js'), 'utf8');
    const sandbox = {
        console,
        fetch: fetchImpl,
        setTimeout,
        clearTimeout
    };

    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;

    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'data-layer.js' });

    return sandbox.SaveResumeDataLayer;
}

function createFakeChrome(initialState = {}) {
    const store = clone(initialState);

    const chromeApi = {
        runtime: {
            lastError: null,
            getManifest() {
                return { version: '1.3.0' };
            }
        },
        storage: {
            local: {
                get(keys, callback) {
                    const result = {};
                    const requestedKeys = Array.isArray(keys) ? keys : [keys];

                    requestedKeys.forEach((key) => {
                        if (Object.prototype.hasOwnProperty.call(store, key)) {
                            result[key] = clone(store[key]);
                        }
                    });

                    callback(result);
                },
                set(data, callback) {
                    Object.entries(data || {}).forEach(([key, value]) => {
                        store[key] = clone(value);
                    });
                    callback();
                },
                remove(keys, callback) {
                    const requestedKeys = Array.isArray(keys) ? keys : [keys];
                    requestedKeys.forEach((key) => {
                        delete store[key];
                    });
                    callback();
                }
            }
        }
    };

    return { chromeApi, store };
}

function createFakeFirestore() {
    let remoteFields = null;

    function buildResponse(status, payload) {
        return {
            status,
            ok: status >= 200 && status < 300,
            async json() {
                return clone(payload);
            }
        };
    }

    return {
        async fetch(_url, options = {}) {
            const method = options.method || 'GET';

            if (method === 'GET') {
                if (!remoteFields) {
                    return buildResponse(404, {});
                }

                return buildResponse(200, { fields: remoteFields });
            }

            if (method === 'PATCH') {
                const body = JSON.parse(options.body || '{}');
                remoteFields = clone(body.fields || {});
                return buildResponse(200, { fields: remoteFields });
            }

            throw new Error(`Unexpected Firestore method in test: ${method}`);
        },
        getCategories() {
            if (!remoteFields?.categoriesJson?.stringValue) {
                return null;
            }

            return JSON.parse(remoteFields.categoriesJson.stringValue);
        }
    };
}

function getVideo(categories, categoryName, videoId) {
    return (categories[categoryName] || []).find((video) => video.videoId === videoId);
}

async function runTest(name, testFn) {
    await testFn();
    console.log(`ok - ${name}`);
}

async function main() {
    await runTest('legacy single-timestamp records round-trip safely', async () => {
        const SaveResumeDataLayer = loadDataLayer();
        const helpers = SaveResumeDataLayer.helpers;

        const legacyVideo = {
            videoId: 'legacy-video',
            title: 'Legacy title',
            currentTime: 125,
            thumbnail: 'https://img.example/legacy.jpg',
            timestamp: 2000
        };

        const normalized = helpers.normalizeLegacyVideoItem(legacyVideo);
        assert.equal(normalized.studyMode, false);
        assert.equal(normalized.currentTime, 125);
        assert.equal(normalized.timestamp, 2000);
        assert.deepEqual(clone(normalized.timestamps), [
            {
                time: 125,
                note: '',
                savedAt: 2000
            }
        ]);

        const localState = helpers.mapLegacyCategoriesToLocal({ Default: [legacyVideo] });
        const roundTrip = helpers.mapLocalToLegacyCategories(localState);
        const roundTripVideo = getVideo(roundTrip, 'Default', 'legacy-video');

        assert.equal(roundTripVideo.currentTime, 125);
        assert.equal(roundTripVideo.timestamp, 2000);
        assert.equal(roundTripVideo.studyMode, false);
        assert.deepEqual(clone(roundTripVideo.timestamps), [
            {
                time: 125,
                note: '',
                savedAt: 2000
            }
        ]);
    });

    await runTest('global study mode is only the default until a video is manually changed', async () => {
        const SaveResumeDataLayer = loadDataLayer();
        const helpers = SaveResumeDataLayer.helpers;

        let video = helpers.appendLegacyTimestampEntry(
            null,
            helpers.createLegacyTimestampEntry(90, '', 1000),
            {
                videoId: 'inherit-video',
                title: 'Inherited mode video',
                currentTime: 90,
                thumbnail: 'https://img.example/inherit.jpg',
                savedAt: 1000,
                studyMode: false,
                studyModeOverridden: false
            }
        );

        assert.equal(video.studyModeOverridden, false);
        assert.equal(helpers.resolveLegacyVideoStudyMode(video, false), false);
        assert.equal(helpers.resolveLegacyVideoStudyMode(video, true), true);

        video = helpers.setLegacyVideoStudyMode(video, false);
        assert.equal(video.studyModeOverridden, true);
        assert.equal(helpers.resolveLegacyVideoStudyMode(video, true), false);

        video = helpers.setLegacyVideoStudyMode(video, true);
        assert.equal(video.studyModeOverridden, true);
        assert.equal(helpers.resolveLegacyVideoStudyMode(video, false), true);

        const roundTrip = helpers.mapLocalToLegacyCategories(
            helpers.mapLegacyCategoriesToLocal({ Default: [video] })
        );
        const roundTripVideo = getVideo(roundTrip, 'Default', 'inherit-video');
        assert.equal(roundTripVideo.studyMode, true);
        assert.equal(roundTripVideo.studyModeOverridden, true);
        assert.equal(helpers.resolveLegacyVideoStudyMode(roundTripVideo, false), true);
    });

    await runTest('videos that keep inheriting global mode stay inheriting after later saves', async () => {
        const SaveResumeDataLayer = loadDataLayer();
        const helpers = SaveResumeDataLayer.helpers;

        let video = helpers.appendLegacyTimestampEntry(
            null,
            helpers.createLegacyTimestampEntry(30, '', 1000),
            {
                videoId: 'still-inheriting-video',
                title: 'Still inheriting',
                currentTime: 30,
                thumbnail: 'https://img.example/still-inheriting.jpg',
                savedAt: 1000,
                studyMode: false,
                studyModeOverridden: false
            }
        );

        video = helpers.appendLegacyTimestampEntry(
            video,
            helpers.createLegacyTimestampEntry(60, 'Second save', 2000),
            {
                title: 'Still inheriting',
                thumbnail: 'https://img.example/still-inheriting.jpg',
                studyMode: false,
                studyModeOverridden: false
            }
        );

        assert.equal(video.studyMode, false);
        assert.equal(video.studyModeOverridden, false);
        assert.equal(helpers.resolveLegacyVideoStudyMode(video, false), false);
        assert.equal(helpers.resolveLegacyVideoStudyMode(video, true), true);
    });

    await runTest('study mode history survives toggle-off and later saves', async () => {
        const SaveResumeDataLayer = loadDataLayer();
        const helpers = SaveResumeDataLayer.helpers;

        let video = helpers.appendLegacyTimestampEntry(
            null,
            helpers.createLegacyTimestampEntry(90, 'Start here', 1000),
            {
                videoId: 'study-video',
                title: 'Study session',
                currentTime: 90,
                thumbnail: 'https://img.example/study.jpg',
                savedAt: 1000,
                studyMode: true
            }
        );

        video = helpers.appendLegacyTimestampEntry(
            video,
            helpers.createLegacyTimestampEntry(180, 'Important concept', 2000),
            {
                title: 'Study session',
                thumbnail: 'https://img.example/study.jpg',
                studyMode: true
            }
        );

        video = helpers.setLegacyVideoStudyMode(video, false);
        video = helpers.appendLegacyTimestampEntry(
            video,
            helpers.createLegacyTimestampEntry(240, '', 3000),
            {
                title: 'Study session',
                thumbnail: 'https://img.example/study.jpg',
                studyMode: false
            }
        );

        assert.equal(video.studyMode, false);
        assert.equal(video.studyModeOverridden, true);
        assert.equal(video.currentTime, 240);
        assert.equal(video.timestamp, 3000);
        assert.equal(video.timestamps.length, 3);
        assert.equal(video.timestamps[0].note, 'Start here');
        assert.equal(video.timestamps[1].note, 'Important concept');
        assert.equal(video.timestamps[2].time, 240);

        const restored = helpers.setLegacyVideoStudyMode(video, true);
        assert.equal(restored.studyMode, true);
        assert.equal(restored.studyModeOverridden, true);
        assert.equal(restored.timestamps.length, 3);
        assert.equal(restored.timestamps[0].note, 'Start here');
        assert.equal(restored.timestamps[1].note, 'Important concept');
    });

    await runTest('signed-out legacy storage migrates safely to the new shape', async () => {
        const SaveResumeDataLayer = loadDataLayer();
        const { chromeApi, store } = createFakeChrome({
            categories: {
                Default: [
                    {
                        videoId: 'offline-video',
                        title: 'Offline legacy video',
                        currentTime: 321,
                        thumbnail: 'https://img.example/offline.jpg',
                        timestamp: 9000
                    }
                ]
            },
            watchlist: []
        });

        const layer = SaveResumeDataLayer.createBackgroundDataLayer({
            chromeApi,
            readFirebaseRuntimeConfig: () => ({ projectId: 'demo-project' }),
            getAuthSession: async () => null,
            getValidAuthSession: async () => {
                throw new Error('getValidAuthSession should not be called for signed-out reads');
            },
            breakingUpdates: {}
        });

        const data = await layer.readData(['categories']);
        const migratedVideo = getVideo(data.categories, 'Default', 'offline-video');

        assert.equal(migratedVideo.currentTime, 321);
        assert.equal(migratedVideo.timestamp, 9000);
        assert.equal(migratedVideo.studyMode, false);
        assert.equal(migratedVideo.studyModeOverridden, false);
        assert.equal(migratedVideo.timestamps.length, 1);
        assert.equal(migratedVideo.timestamps[0].time, 321);

        assert.deepEqual(store.categories, { Default: ['offline-video'] });
        assert.equal(store.timestamps['offline-video'].timestamp, 321);
        assert.equal(store.timestamps['offline-video'].savedAt, 9000);
        assert.equal(store.timestamps['offline-video'].studyMode, false);
        assert.equal(store.timestamps['offline-video'].studyModeOverridden, false);
        assert.equal(store.timestamps['offline-video'].timestamps.length, 1);
        assert.ok(!Object.prototype.hasOwnProperty.call(store, 'watchlist'));
    });

    await runTest('signed-in sync preserves hidden timestamp history through queue, flush, and readback', async () => {
        const fakeFirestore = createFakeFirestore();
        const SaveResumeDataLayer = loadDataLayer(fakeFirestore.fetch.bind(fakeFirestore));
        const helpers = SaveResumeDataLayer.helpers;
        const { chromeApi, store } = createFakeChrome();
        const session = {
            uid: 'user-1',
            idToken: 'token-1'
        };

        const layer = SaveResumeDataLayer.createBackgroundDataLayer({
            chromeApi,
            readFirebaseRuntimeConfig: () => ({ projectId: 'demo-project' }),
            getAuthSession: async () => session,
            getValidAuthSession: async () => session,
            breakingUpdates: {}
        });

        let video = helpers.appendLegacyTimestampEntry(
            null,
            helpers.createLegacyTimestampEntry(45, 'Intro note', 1000),
            {
                videoId: 'synced-video',
                title: 'Synced study video',
                currentTime: 45,
                thumbnail: 'https://img.example/synced.jpg',
                savedAt: 1000,
                studyMode: true
            }
        );
        video = helpers.appendLegacyTimestampEntry(
            video,
            helpers.createLegacyTimestampEntry(90, 'Deep dive', 2000),
            {
                title: 'Synced study video',
                thumbnail: 'https://img.example/synced.jpg',
                studyMode: true
            }
        );
        video = helpers.setLegacyVideoStudyMode(video, false);
        video = helpers.appendLegacyTimestampEntry(
            video,
            helpers.createLegacyTimestampEntry(120, '', 3000),
            {
                title: 'Synced study video',
                thumbnail: 'https://img.example/synced.jpg',
                studyMode: false
            }
        );

        await layer.setNetworkStatus(false);
        const queuedWrite = await layer.writeData({
            categories: {
                Default: [video]
            }
        });

        assert.equal(queuedWrite.storageMode, 'queued');
        assert.equal(fakeFirestore.getCategories(), null);
        assert.equal(store.timestamps['synced-video'].syncPending, true);
        assert.equal(store.timestamps['synced-video'].timestamps.length, 3);

        const flushResult = await layer.setNetworkStatus(true);
        assert.equal(flushResult.flushed, true);
        assert.equal(store.timestamps['synced-video'].syncPending, false);

        const remoteVideo = getVideo(fakeFirestore.getCategories(), 'Default', 'synced-video');
        assert.equal(remoteVideo.studyMode, false);
        assert.equal(remoteVideo.studyModeOverridden, true);
        assert.equal(remoteVideo.currentTime, 120);
        assert.equal(remoteVideo.timestamp, 3000);
        assert.equal(remoteVideo.timestamps.length, 3);
        assert.equal(remoteVideo.timestamps[0].note, 'Intro note');
        assert.equal(remoteVideo.timestamps[1].note, 'Deep dive');
        assert.equal(remoteVideo.timestamps[2].time, 120);

        const readBack = await layer.readData(['categories']);
        const readBackVideo = getVideo(readBack.categories, 'Default', 'synced-video');
        assert.equal(readBackVideo.studyMode, false);
        assert.equal(readBackVideo.studyModeOverridden, true);
        assert.equal(readBackVideo.currentTime, 120);
        assert.equal(readBackVideo.timestamp, 3000);
        assert.equal(readBackVideo.timestamps.length, 3);
        assert.equal(readBackVideo.timestamps[0].note, 'Intro note');
        assert.equal(readBackVideo.timestamps[1].note, 'Deep dive');
    });
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
