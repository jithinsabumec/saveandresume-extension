(function initSaveResumeDataLayer(globalScope) {
    'use strict';

    const STORAGE_KEYS = {
        timestamps: 'timestamps',
        categories: 'categories',
        schemaVersion: 'schemaVersion',
        lastSyncedAt: 'lastSyncedAt',
        syncQueueDirty: 'syncQueueDirty',
        migrationComplete: 'migrationComplete',
        migrationCompletedAt: 'migrationCompletedAt',
        lastSeenVersion: 'lastSeenVersion',
        pendingBreakingUpdateNotice: 'pendingBreakingUpdateNotice',
        networkOnlineHint: 'networkOnlineHint',
        watchlist: 'watchlist'
    };

    const STATE_DOC_PATH_SUFFIX = '/data/state';
    const LOCAL_SCHEMA_VERSION = 3;

    function isObject(value) {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    function toNumber(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function normalizeStudyTimestampEntry(entry, fallbackTime = 0, fallbackSavedAt = Date.now()) {
        if (!isObject(entry)) {
            return {
                time: Math.max(0, toNumber(fallbackTime, 0)),
                note: '',
                savedAt: Math.max(0, toNumber(fallbackSavedAt, Date.now()))
            };
        }

        return {
            time: Math.max(0, toNumber(entry.time, fallbackTime)),
            note: typeof entry.note === 'string' ? entry.note : '',
            savedAt: Math.max(0, toNumber(entry.savedAt, fallbackSavedAt))
        };
    }

    function normalizeStudyTimestampEntries(entries, fallbackTime = 0, fallbackSavedAt = Date.now()) {
        if (!Array.isArray(entries) || entries.length === 0) {
            return [normalizeStudyTimestampEntry(null, fallbackTime, fallbackSavedAt)];
        }

        const normalized = entries
            .map((entry) => normalizeStudyTimestampEntry(entry, fallbackTime, fallbackSavedAt))
            .filter(Boolean);

        if (normalized.length === 0) {
            return [normalizeStudyTimestampEntry(null, fallbackTime, fallbackSavedAt)];
        }

        return normalized;
    }

    function getMostRecentStudyTimestampEntry(entries, fallbackTime = 0, fallbackSavedAt = Date.now()) {
        const normalized = normalizeStudyTimestampEntries(entries, fallbackTime, fallbackSavedAt);
        return normalized.reduce((latest, entry) => {
            if (!latest) {
                return entry;
            }

            return entry.savedAt >= latest.savedAt ? entry : latest;
        }, null);
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function createStorageAdapter(chromeApi) {
        return {
            async get(keys) {
                return new Promise((resolve, reject) => {
                    chromeApi.storage.local.get(keys, (result) => {
                        if (chromeApi.runtime.lastError) {
                            reject(chromeApi.runtime.lastError);
                            return;
                        }
                        resolve(result || {});
                    });
                });
            },
            async set(data) {
                return new Promise((resolve, reject) => {
                    chromeApi.storage.local.set(data, () => {
                        if (chromeApi.runtime.lastError) {
                            reject(chromeApi.runtime.lastError);
                            return;
                        }
                        resolve();
                    });
                });
            },
            async remove(keys) {
                return new Promise((resolve, reject) => {
                    chromeApi.storage.local.remove(keys, () => {
                        if (chromeApi.runtime.lastError) {
                            reject(chromeApi.runtime.lastError);
                            return;
                        }
                        resolve();
                    });
                });
            }
        };
    }

    function normalizeCategoryName(categoryName) {
        if (typeof categoryName !== 'string') {
            return null;
        }

        const trimmed = categoryName.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    function normalizeTimestampRecord(videoId, record) {
        if (typeof videoId !== 'string' || videoId.trim() === '' || !isObject(record)) {
            return null;
        }

        const safeTimestamp = Math.max(0, toNumber(record.timestamp, 0));
        const safeSavedAt = Math.max(0, toNumber(record.savedAt, Date.now()));
        const normalizedTimestampEntries = normalizeStudyTimestampEntries(record.timestamps, safeTimestamp, safeSavedAt);
        const latestTimestampEntry = getMostRecentStudyTimestampEntry(normalizedTimestampEntries, safeTimestamp, safeSavedAt);

        return {
            timestamp: Math.max(0, toNumber(record.timestamp, latestTimestampEntry.time)),
            title: typeof record.title === 'string' ? record.title : '',
            savedAt: Math.max(0, toNumber(record.savedAt, latestTimestampEntry.savedAt)),
            thumbnail: typeof record.thumbnail === 'string' ? record.thumbnail : '',
            syncPending: record.syncPending === true,
            studyMode: record.studyMode === true,
            timestamps: normalizedTimestampEntries
        };
    }

    function createDefaultLocalState() {
        return {
            timestamps: {},
            categories: { Default: [] },
            schemaVersion: LOCAL_SCHEMA_VERSION,
            lastSyncedAt: null,
            syncQueueDirty: false,
            migrationComplete: false,
            migrationCompletedAt: null
        };
    }

    function normalizeLocalSchema(rawLocal) {
        const source = isObject(rawLocal) ? rawLocal : {};

        const normalizedTimestamps = {};
        if (isObject(source.timestamps)) {
            Object.entries(source.timestamps).forEach(([videoId, record]) => {
                const normalized = normalizeTimestampRecord(videoId, record);
                if (!normalized) {
                    return;
                }
                normalizedTimestamps[videoId] = normalized;
            });
        }

        const normalizedCategories = {};
        if (isObject(source.categories)) {
            Object.entries(source.categories).forEach(([categoryName, videoIds]) => {
                const safeCategoryName = normalizeCategoryName(categoryName);
                if (!safeCategoryName || !Array.isArray(videoIds)) {
                    return;
                }

                const dedupedIds = [];
                videoIds.forEach((videoId) => {
                    if (typeof videoId !== 'string' || videoId.trim() === '') {
                        return;
                    }
                    if (dedupedIds.includes(videoId)) {
                        return;
                    }
                    if (!normalizedTimestamps[videoId]) {
                        return;
                    }
                    dedupedIds.push(videoId);
                });

                normalizedCategories[safeCategoryName] = dedupedIds;
            });
        }

        if (!Object.keys(normalizedCategories).length) {
            normalizedCategories.Default = [];
        }

        if (!Array.isArray(normalizedCategories.Default)) {
            normalizedCategories.Default = [];
        }

        return {
            timestamps: normalizedTimestamps,
            categories: normalizedCategories,
            schemaVersion: LOCAL_SCHEMA_VERSION,
            lastSyncedAt: Number.isFinite(Number(source.lastSyncedAt)) ? Number(source.lastSyncedAt) : null,
            syncQueueDirty: source.syncQueueDirty === true,
            migrationComplete: source.migrationComplete === true,
            migrationCompletedAt: Number.isFinite(Number(source.migrationCompletedAt)) ? Number(source.migrationCompletedAt) : null
        };
    }

    function normalizeLegacyVideo(video) {
        if (!isObject(video)) {
            return null;
        }

        if (typeof video.videoId !== 'string' || video.videoId.trim() === '') {
            return null;
        }

        const timestamp = Math.max(0, toNumber(video.currentTime, 0));
        const savedAt = Math.max(0, toNumber(video.timestamp, Date.now()));
        const normalizedTimestampEntries = normalizeStudyTimestampEntries(video.timestamps, timestamp, savedAt);
        const latestTimestampEntry = getMostRecentStudyTimestampEntry(normalizedTimestampEntries, timestamp, savedAt);

        return {
            videoId: video.videoId,
            record: {
                timestamp: Math.max(0, toNumber(video.currentTime, latestTimestampEntry.time)),
                title: typeof video.title === 'string' ? video.title : '',
                savedAt: Math.max(0, toNumber(video.timestamp, latestTimestampEntry.savedAt)),
                thumbnail: typeof video.thumbnail === 'string' ? video.thumbnail : '',
                syncPending: false,
                studyMode: video.studyMode === true,
                timestamps: normalizedTimestampEntries
            }
        };
    }

    function legacyCategoriesToLocal(legacyCategories, legacyWatchlist) {
        const local = createDefaultLocalState();

        const applyVideo = (categoryName, video) => {
            const safeCategoryName = normalizeCategoryName(categoryName);
            if (!safeCategoryName) {
                return;
            }

            const normalized = normalizeLegacyVideo(video);
            if (!normalized) {
                return;
            }

            if (!local.categories[safeCategoryName]) {
                local.categories[safeCategoryName] = [];
            }

            const { videoId, record } = normalized;
            const existing = local.timestamps[videoId];
            if (!existing || record.savedAt >= existing.savedAt) {
                local.timestamps[videoId] = record;
            }

            if (!local.categories[safeCategoryName].includes(videoId)) {
                local.categories[safeCategoryName].push(videoId);
            }
        };

        if (isObject(legacyCategories)) {
            Object.entries(legacyCategories).forEach(([categoryName, list]) => {
                const safeCategoryName = normalizeCategoryName(categoryName);
                if (!safeCategoryName || !Array.isArray(list)) {
                    return;
                }

                // Preserve empty categories from legacy shape (needed for manual category management).
                if (!local.categories[safeCategoryName]) {
                    local.categories[safeCategoryName] = [];
                }

                list.forEach((video) => applyVideo(safeCategoryName, video));
            });
        }

        if (Array.isArray(legacyWatchlist) && legacyWatchlist.length > 0) {
            legacyWatchlist.forEach((video) => applyVideo('Default', video));
        }

        if (!local.categories.Default) {
            local.categories.Default = [];
        }

        return local;
    }

    function mapLocalToLegacyCategories(localState) {
        const local = normalizeLocalSchema(localState);
        const categories = {};

        Object.entries(local.categories).forEach(([categoryName, videoIds]) => {
            const videos = [];

            videoIds.forEach((videoId) => {
                const record = local.timestamps[videoId];
                if (!record) {
                    return;
                }

                videos.push({
                    videoId,
                    title: record.title || '',
                    currentTime: toNumber(record.timestamp, 0),
                    thumbnail: typeof record.thumbnail === 'string' ? record.thumbnail : '',
                    timestamp: toNumber(record.savedAt, Date.now()),
                    studyMode: record.studyMode === true,
                    timestamps: Array.isArray(record.timestamps)
                        ? record.timestamps.map((entry) => ({
                            time: Math.max(0, toNumber(entry.time, 0)),
                            note: typeof entry.note === 'string' ? entry.note : '',
                            savedAt: Math.max(0, toNumber(entry.savedAt, Date.now()))
                        }))
                        : []
                });
            });

            videos.sort((a, b) => b.timestamp - a.timestamp);
            categories[categoryName] = videos;
        });

        return categories;
    }

    function mapLegacyCategoriesToLocal(categories) {
        return legacyCategoriesToLocal(categories, []);
    }

    function mergeRemoteWithLocalForMigration(remoteLocalState, localState) {
        const remoteLocal = normalizeLocalSchema(remoteLocalState);
        const local = normalizeLocalSchema(localState);

        const merged = clone(remoteLocal);

        Object.entries(local.timestamps).forEach(([videoId, localRecord]) => {
            merged.timestamps[videoId] = {
                ...localRecord,
                syncPending: false
            };

            Object.keys(merged.categories).forEach((categoryName) => {
                merged.categories[categoryName] = merged.categories[categoryName].filter((id) => id !== videoId);
            });

            Object.entries(local.categories).forEach(([categoryName, videoIds]) => {
                if (!videoIds.includes(videoId)) {
                    return;
                }

                if (!merged.categories[categoryName]) {
                    merged.categories[categoryName] = [];
                }

                if (!merged.categories[categoryName].includes(videoId)) {
                    merged.categories[categoryName].push(videoId);
                }
            });
        });

        Object.keys(merged.categories).forEach((categoryName) => {
            const deduped = [];
            merged.categories[categoryName].forEach((videoId) => {
                if (!merged.timestamps[videoId]) {
                    return;
                }
                if (!deduped.includes(videoId)) {
                    deduped.push(videoId);
                }
            });
            merged.categories[categoryName] = deduped;
        });

        if (!merged.categories.Default) {
            merged.categories.Default = [];
        }

        return merged;
    }

    function clearSyncPendingFlags(localState) {
        const local = normalizeLocalSchema(localState);
        const cleaned = clone(local);

        Object.keys(cleaned.timestamps).forEach((videoId) => {
            cleaned.timestamps[videoId].syncPending = false;
        });

        cleaned.syncQueueDirty = false;
        cleaned.lastSyncedAt = Date.now();

        return cleaned;
    }

    function markSyncPending(localState) {
        const local = normalizeLocalSchema(localState);
        const pending = clone(local);

        Object.keys(pending.timestamps).forEach((videoId) => {
            pending.timestamps[videoId].syncPending = true;
        });

        pending.syncQueueDirty = true;

        return pending;
    }

    function hasSyncPending(localState) {
        const local = normalizeLocalSchema(localState);

        if (local.syncQueueDirty) {
            return true;
        }

        return Object.values(local.timestamps).some((record) => record.syncPending === true);
    }

    function countLocalTimestamps(localState) {
        const local = normalizeLocalSchema(localState);
        return Object.keys(local.timestamps).length;
    }

    function isLikelyOfflineError(error) {
        if (!error) {
            return false;
        }

        const message = String(error.message || error);
        return (
            message.includes('Failed to fetch') ||
            message.includes('NetworkError') ||
            message.includes('network request failed') ||
            message.includes('ERR_INTERNET_DISCONNECTED') ||
            message.includes('OFFLINE')
        );
    }

    function compareVersions(a, b) {
        const parse = (value) => String(value || '0').split('.').map((segment) => Number(segment) || 0);
        const left = parse(a);
        const right = parse(b);
        const maxLength = Math.max(left.length, right.length);

        for (let index = 0; index < maxLength; index += 1) {
            const leftPart = left[index] || 0;
            const rightPart = right[index] || 0;

            if (leftPart > rightPart) {
                return 1;
            }
            if (leftPart < rightPart) {
                return -1;
            }
        }

        return 0;
    }

    function createClientDataLayer(chromeApi = globalScope.chrome) {
        let listenersAttached = false;

        function runtimeRequest(message) {
            return new Promise((resolve, reject) => {
                chromeApi.runtime.sendMessage(message, (response) => {
                    if (chromeApi.runtime.lastError) {
                        reject(new Error(chromeApi.runtime.lastError.message));
                        return;
                    }

                    if (!response || response.ok !== true) {
                        reject(new Error(response?.error || 'UNKNOWN_ERROR'));
                        return;
                    }

                    resolve(response);
                });
            });
        }

        function emitNetworkStatus(isOnline) {
            runtimeRequest({
                type: 'DATA_NETWORK_STATUS',
                online: Boolean(isOnline)
            }).catch(() => {
                // Ignore if service worker is sleeping.
            });
        }

        function attachNetworkListenersIfNeeded() {
            if (listenersAttached) {
                return;
            }

            if (typeof globalScope.addEventListener !== 'function' || typeof navigator === 'undefined') {
                return;
            }

            listenersAttached = true;

            emitNetworkStatus(navigator.onLine !== false);

            globalScope.addEventListener('online', () => emitNetworkStatus(true));
            globalScope.addEventListener('offline', () => emitNetworkStatus(false));
        }

        attachNetworkListenersIfNeeded();

        return {
            async get(keys) {
                const response = await runtimeRequest({ type: 'DATA_GET', keys });
                return response.data || {};
            },
            async set(data) {
                const response = await runtimeRequest({ type: 'DATA_SET', data });
                return response;
            },
            async getLocalSummary() {
                const response = await runtimeRequest({ type: 'DATA_LOCAL_SUMMARY' });
                return {
                    hasLocalData: Boolean(response.hasLocalData),
                    localVideoCount: Number(response.localVideoCount || 0)
                };
            },
            async migrateLocalDataToCloud() {
                const response = await runtimeRequest({ type: 'DATA_MIGRATE_LOCAL' });
                return response;
            },
            async getBreakingUpdateNotice() {
                const response = await runtimeRequest({ type: 'DATA_GET_BREAKING_UPDATE_NOTICE' });
                return response.notice || null;
            },
            async dismissBreakingUpdateNotice() {
                await runtimeRequest({ type: 'DATA_DISMISS_BREAKING_UPDATE_NOTICE' });
            }
        };
    }

    function createBackgroundDataLayer(options) {
        const {
            chromeApi,
            readFirebaseRuntimeConfig,
            getAuthSession,
            getValidAuthSession,
            breakingUpdates
        } = options;

        const storage = createStorageAdapter(chromeApi);
        let networkOnlineHint = true;

        function getFirestoreBaseUrl() {
            const { projectId } = readFirebaseRuntimeConfig();
            return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
        }

        function buildStateDocUrl(uid) {
            return `${getFirestoreBaseUrl()}/users/${encodeURIComponent(uid)}${STATE_DOC_PATH_SUFFIX}`;
        }

        async function firestoreFetchState(uid, idToken) {
            const response = await fetch(buildStateDocUrl(uid), {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${idToken}`
                }
            });

            if (response.status === 404) {
                return {
                    categories: {},
                    migrationComplete: false
                };
            }

            const payload = await response.json().catch(() => ({}));

            if (!response.ok) {
                const message = payload?.error?.message || `Firestore fetch failed (${response.status})`;
                throw new Error(message);
            }

            const fields = payload?.fields || {};
            let categories = {};

            if (fields.categoriesJson?.stringValue) {
                try {
                    categories = JSON.parse(fields.categoriesJson.stringValue);
                } catch (error) {
                    categories = {};
                }
            }

            return {
                categories,
                migrationComplete: fields.migrationComplete?.booleanValue === true
            };
        }

        async function firestoreSaveState(uid, idToken, categories, options = {}) {
            const localFromCategories = mapLegacyCategoriesToLocal(categories);
            const normalizedCategories = mapLocalToLegacyCategories(localFromCategories);
            const now = Date.now();

            const fields = {
                schemaVersion: { integerValue: String(LOCAL_SCHEMA_VERSION) },
                categoriesJson: { stringValue: JSON.stringify(normalizedCategories) },
                migrationComplete: { booleanValue: options.migrationComplete !== false },
                updatedAt: { integerValue: String(now) }
            };

            if (options.migrationComplete !== false) {
                fields.migratedAt = { integerValue: String(options.migratedAt || now) };
            }

            const response = await fetch(buildStateDocUrl(uid), {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ fields })
            });

            const payload = await response.json().catch(() => ({}));

            if (!response.ok) {
                const message = payload?.error?.message || `Firestore save failed (${response.status})`;
                throw new Error(message);
            }

            return payload;
        }

        async function readLocalStateRaw() {
            const result = await storage.get([
                STORAGE_KEYS.timestamps,
                STORAGE_KEYS.categories,
                STORAGE_KEYS.schemaVersion,
                STORAGE_KEYS.lastSyncedAt,
                STORAGE_KEYS.syncQueueDirty,
                STORAGE_KEYS.migrationComplete,
                STORAGE_KEYS.migrationCompletedAt,
                STORAGE_KEYS.watchlist
            ]);

            if (
                isObject(result[STORAGE_KEYS.timestamps]) &&
                isObject(result[STORAGE_KEYS.categories])
            ) {
                return normalizeLocalSchema({
                    timestamps: result[STORAGE_KEYS.timestamps],
                    categories: result[STORAGE_KEYS.categories],
                    schemaVersion: LOCAL_SCHEMA_VERSION,
                    lastSyncedAt: result[STORAGE_KEYS.lastSyncedAt] ?? null,
                    syncQueueDirty: result[STORAGE_KEYS.syncQueueDirty] === true,
                    migrationComplete: result[STORAGE_KEYS.migrationComplete] === true,
                    migrationCompletedAt: result[STORAGE_KEYS.migrationCompletedAt] ?? null
                });
            }

            const migratedFromLegacy = legacyCategoriesToLocal(
                result[STORAGE_KEYS.categories],
                result[STORAGE_KEYS.watchlist]
            );

            const normalized = normalizeLocalSchema({
                ...migratedFromLegacy,
                lastSyncedAt: result[STORAGE_KEYS.lastSyncedAt] ?? null,
                syncQueueDirty: result[STORAGE_KEYS.syncQueueDirty] === true,
                migrationComplete: result[STORAGE_KEYS.migrationComplete] === true,
                migrationCompletedAt: result[STORAGE_KEYS.migrationCompletedAt] ?? null
            });

            await writeLocalState(normalized, { removeLegacyWatchlist: true });
            return normalized;
        }

        async function writeLocalState(localState, options = {}) {
            const normalized = normalizeLocalSchema(localState);
            const payload = {
                [STORAGE_KEYS.timestamps]: normalized.timestamps,
                [STORAGE_KEYS.categories]: normalized.categories,
                [STORAGE_KEYS.schemaVersion]: LOCAL_SCHEMA_VERSION,
                [STORAGE_KEYS.lastSyncedAt]: normalized.lastSyncedAt,
                [STORAGE_KEYS.syncQueueDirty]: normalized.syncQueueDirty,
                [STORAGE_KEYS.migrationComplete]: normalized.migrationComplete,
                [STORAGE_KEYS.migrationCompletedAt]: normalized.migrationCompletedAt
            };

            await storage.set(payload);

            if (options.removeLegacyWatchlist) {
                await storage.remove([STORAGE_KEYS.watchlist]);
            }
        }

        function projectDataByKeys(localState, keys) {
            const requestedKeys = Array.isArray(keys) ? keys : [keys];
            const categories = mapLocalToLegacyCategories(localState);
            const result = {};

            requestedKeys.forEach((key) => {
                if (key === 'categories') {
                    result.categories = categories;
                    return;
                }

                if (key === 'timestamps') {
                    result.timestamps = normalizeLocalSchema(localState).timestamps;
                    return;
                }

                if (key === 'watchlist') {
                    result.watchlist = [];
                    return;
                }

                if (key === 'schemaVersion') {
                    result.schemaVersion = LOCAL_SCHEMA_VERSION;
                    return;
                }

                if (key === 'lastSyncedAt') {
                    result.lastSyncedAt = normalizeLocalSchema(localState).lastSyncedAt;
                    return;
                }

                result[key] = undefined;
            });

            return result;
        }

        async function isSignedIn() {
            const session = await getAuthSession();
            return Boolean(session && typeof session.uid === 'string' && session.uid.trim() !== '');
        }

        async function flushPendingQueue() {
            const signedIn = await isSignedIn();
            if (!signedIn) {
                return { flushed: false, reason: 'SIGNED_OUT' };
            }

            if (!networkOnlineHint) {
                return { flushed: false, reason: 'OFFLINE' };
            }

            const localState = await readLocalStateRaw();
            if (!hasSyncPending(localState)) {
                return { flushed: false, reason: 'NO_PENDING' };
            }

            const session = await getValidAuthSession();
            await firestoreSaveState(
                session.uid,
                session.idToken,
                mapLocalToLegacyCategories(localState),
                { migrationComplete: true }
            );

            const cleaned = clearSyncPendingFlags(localState);
            cleaned.migrationComplete = true;
            await writeLocalState(cleaned);

            return {
                flushed: true,
                syncedCount: countLocalTimestamps(cleaned)
            };
        }

        async function readData(keys) {
            const localState = await readLocalStateRaw();
            const signedIn = await isSignedIn();

            if (!signedIn) {
                return projectDataByKeys(localState, keys);
            }

            if (!networkOnlineHint) {
                return projectDataByKeys(localState, keys);
            }

            try {
                const session = await getValidAuthSession();

                if (hasSyncPending(localState)) {
                    await flushPendingQueue();
                }

                const remoteState = await firestoreFetchState(session.uid, session.idToken);
                const remoteLocalState = mapLegacyCategoriesToLocal(remoteState.categories);
                const cachedLocalState = clearSyncPendingFlags(remoteLocalState);
                cachedLocalState.migrationComplete = remoteState.migrationComplete;
                cachedLocalState.migrationCompletedAt = remoteState.migrationComplete
                    ? (cachedLocalState.migrationCompletedAt || Date.now())
                    : cachedLocalState.migrationCompletedAt;

                await writeLocalState(cachedLocalState);
                return projectDataByKeys(cachedLocalState, keys);
            } catch (error) {
                if (!isLikelyOfflineError(error)) {
                    console.warn('Falling back to local cache for read because Firestore read failed:', error?.message || error);
                }
                return projectDataByKeys(localState, keys);
            }
        }

        function mergePendingFlags(previousLocalState, nextLocalState) {
            const previous = normalizeLocalSchema(previousLocalState);
            const next = normalizeLocalSchema(nextLocalState);
            const merged = clone(next);

            Object.entries(merged.timestamps).forEach(([videoId, record]) => {
                const previousRecord = previous.timestamps[videoId];
                if (previousRecord && previousRecord.syncPending === true) {
                    record.syncPending = true;
                }
            });

            return merged;
        }

        async function writeData(data) {
            if (!isObject(data)) {
                return { success: true };
            }

            const currentLocalState = await readLocalStateRaw();
            let nextLocalState = currentLocalState;

            if (Object.prototype.hasOwnProperty.call(data, 'categories')) {
                nextLocalState = mapLegacyCategoriesToLocal(data.categories || {});
                nextLocalState.lastSyncedAt = currentLocalState.lastSyncedAt;
                nextLocalState.migrationComplete = currentLocalState.migrationComplete;
                nextLocalState.migrationCompletedAt = currentLocalState.migrationCompletedAt;
                nextLocalState.syncQueueDirty = currentLocalState.syncQueueDirty;
            }

            if (Object.prototype.hasOwnProperty.call(data, 'timestamps') && isObject(data.timestamps)) {
                nextLocalState = normalizeLocalSchema({
                    ...nextLocalState,
                    timestamps: data.timestamps
                });
            }

            const signedIn = await isSignedIn();
            if (!signedIn) {
                await writeLocalState(normalizeLocalSchema(nextLocalState));
                return { success: true, storageMode: 'local' };
            }

            if (networkOnlineHint) {
                try {
                    const session = await getValidAuthSession();
                    await firestoreSaveState(
                        session.uid,
                        session.idToken,
                        mapLocalToLegacyCategories(nextLocalState),
                        { migrationComplete: true }
                    );

                    const cachedLocal = clearSyncPendingFlags(nextLocalState);
                    cachedLocal.migrationComplete = true;
                    cachedLocal.migrationCompletedAt = cachedLocal.migrationCompletedAt || Date.now();
                    await writeLocalState(cachedLocal);

                    return { success: true, storageMode: 'firestore' };
                } catch (error) {
                    if (!isLikelyOfflineError(error)) {
                        throw error;
                    }
                }
            }

            let pendingLocal = markSyncPending(nextLocalState);
            pendingLocal = mergePendingFlags(currentLocalState, pendingLocal);
            pendingLocal.migrationComplete = true;
            pendingLocal.migrationCompletedAt = pendingLocal.migrationCompletedAt || Date.now();

            await writeLocalState(pendingLocal);
            return { success: true, storageMode: 'queued' };
        }

        async function getLocalSummary() {
            const localState = await readLocalStateRaw();
            const localVideoCount = countLocalTimestamps(localState);
            return {
                hasLocalData: localVideoCount > 0,
                localVideoCount
            };
        }

        async function migrateLocalDataToCloud() {
            const session = await getValidAuthSession();

            // Step 1: Read all local data.
            const localData = await readLocalStateRaw();

            // Step 2: Skip migration if there are no local timestamps.
            const localTimestampCount = countLocalTimestamps(localData);
            if (localTimestampCount === 0) {
                const cleared = normalizeLocalSchema({
                    ...localData,
                    timestamps: {},
                    categories: { Default: [] },
                    migrationComplete: true,
                    migrationCompletedAt: Date.now(),
                    syncQueueDirty: false
                });

                await writeLocalState(cleared);

                return {
                    migrated: false,
                    skipped: true,
                    localTimestampCount: 0,
                    message: 'No local timestamps found. Migration skipped.'
                };
            }

            // Step 4: Load existing Firestore state.
            const remoteState = await firestoreFetchState(session.uid, session.idToken);
            const remoteLocal = mapLegacyCategoriesToLocal(remoteState.categories);

            // Step 5: Merge local into Firestore state with local priority.
            const mergedLocal = mergeRemoteWithLocalForMigration(remoteLocal, localData);

            // Step 6: Save merged data; local storage remains untouched on failure.
            await firestoreSaveState(
                session.uid,
                session.idToken,
                mapLocalToLegacyCategories(mergedLocal),
                { migrationComplete: true }
            );

            // Step 7 + 8: Clear local timestamps after confirmed write and mark migration complete.
            const migratedAt = Date.now();
            await writeLocalState(normalizeLocalSchema({
                timestamps: {},
                categories: { Default: [] },
                schemaVersion: LOCAL_SCHEMA_VERSION,
                lastSyncedAt: null,
                syncQueueDirty: false,
                migrationComplete: true,
                migrationCompletedAt: migratedAt
            }));

            return {
                migrated: true,
                skipped: false,
                localTimestampCount,
                message: `Migrated ${localTimestampCount} timestamps to your account.`
            };
        }

        async function cacheFirestoreToLocalBeforeSignOut() {
            const signedIn = await isSignedIn();
            if (!signedIn) {
                return { cached: false, reason: 'SIGNED_OUT' };
            }

            if (!networkOnlineHint) {
                return { cached: false, reason: 'OFFLINE' };
            }

            const session = await getValidAuthSession();
            const remoteState = await firestoreFetchState(session.uid, session.idToken);
            const remoteLocal = mapLegacyCategoriesToLocal(remoteState.categories);
            const localCache = clearSyncPendingFlags(remoteLocal);
            localCache.migrationComplete = true;
            localCache.migrationCompletedAt = localCache.migrationCompletedAt || Date.now();
            await writeLocalState(localCache);

            return { cached: true, reason: 'OK' };
        }

        async function setNetworkStatus(online) {
            networkOnlineHint = Boolean(online);

            await storage.set({
                [STORAGE_KEYS.networkOnlineHint]: networkOnlineHint
            });

            if (!networkOnlineHint) {
                return { online: false, flushed: false };
            }

            try {
                const flushResult = await flushPendingQueue();
                return {
                    online: true,
                    flushed: flushResult.flushed === true
                };
            } catch (error) {
                if (isLikelyOfflineError(error)) {
                    return {
                        online: true,
                        flushed: false
                    };
                }
                throw error;
            }
        }

        async function bootstrapVersionState() {
            const manifestVersion = chromeApi.runtime.getManifest()?.version || '0.0.0';
            const result = await storage.get([
                STORAGE_KEYS.lastSeenVersion,
                STORAGE_KEYS.pendingBreakingUpdateNotice
            ]);

            const lastSeenVersion = typeof result[STORAGE_KEYS.lastSeenVersion] === 'string'
                ? result[STORAGE_KEYS.lastSeenVersion]
                : null;

            const isUpgrade = !lastSeenVersion || compareVersions(manifestVersion, lastSeenVersion) > 0;

            let pendingNotice = result[STORAGE_KEYS.pendingBreakingUpdateNotice] || null;

            if (isUpgrade) {
                const breakingUpdate = isObject(breakingUpdates)
                    ? breakingUpdates[manifestVersion]
                    : null;

                if (breakingUpdate) {
                    pendingNotice = {
                        version: manifestVersion,
                        effectiveDate: String(breakingUpdate.effectiveDate || ''),
                        message: String(breakingUpdate.message || ''),
                        bannerText: `An update is coming on ${breakingUpdate.effectiveDate} that changes how your data is stored. Your data is safe and will be migrated automatically.`
                    };
                } else {
                    pendingNotice = null;
                }

                await storage.set({
                    [STORAGE_KEYS.lastSeenVersion]: manifestVersion,
                    [STORAGE_KEYS.pendingBreakingUpdateNotice]: pendingNotice
                });
            }

            return {
                currentVersion: manifestVersion,
                lastSeenVersion,
                pendingNotice
            };
        }

        async function getBreakingUpdateNotice() {
            const result = await storage.get([STORAGE_KEYS.pendingBreakingUpdateNotice]);
            return result[STORAGE_KEYS.pendingBreakingUpdateNotice] || null;
        }

        async function dismissBreakingUpdateNotice() {
            await storage.set({
                [STORAGE_KEYS.pendingBreakingUpdateNotice]: null
            });
        }

        return {
            readData,
            writeData,
            getLocalSummary,
            migrateLocalDataToCloud,
            cacheFirestoreToLocalBeforeSignOut,
            flushPendingQueue,
            setNetworkStatus,
            bootstrapVersionState,
            getBreakingUpdateNotice,
            dismissBreakingUpdateNotice,
            isLikelyOfflineError
        };
    }

    globalScope.SaveResumeDataLayer = {
        LOCAL_SCHEMA_VERSION,
        STORAGE_KEYS,
        createClientDataLayer,
        createBackgroundDataLayer,
        helpers: {
            normalizeLocalSchema,
            mapLegacyCategoriesToLocal,
            mapLocalToLegacyCategories,
            mergeRemoteWithLocalForMigration,
            compareVersions
        }
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
