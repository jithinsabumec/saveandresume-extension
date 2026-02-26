'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');
const outputPath = path.join(rootDir, 'firebase-config.js');

const REQUIRED_ENV_KEYS = [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID'
];

function parseEnvFile(contents) {
    const result = {};
    const lines = contents.split(/\r?\n/);

    lines.forEach((rawLine) => {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            return;
        }

        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) {
            return;
        }

        const key = line.slice(0, separatorIndex).trim();
        if (!key) {
            return;
        }

        let value = line.slice(separatorIndex + 1).trim();
        const isQuoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''));
        if (isQuoted) {
            value = value.slice(1, -1);
        }

        if (value.includes('\\n')) {
            value = value.replace(/\\n/g, '\n');
        }

        result[key] = value;
    });

    return result;
}

function loadEnvFile() {
    if (!fs.existsSync(envPath)) {
        return {};
    }

    const fileContents = fs.readFileSync(envPath, 'utf8');
    return parseEnvFile(fileContents);
}

function getCombinedEnv() {
    const fileEnv = loadEnvFile();
    return {
        ...fileEnv,
        ...process.env
    };
}

function findMissingKeys(env) {
    return REQUIRED_ENV_KEYS.filter((key) => {
        const value = env[key];
        return typeof value !== 'string' || value.trim() === '';
    });
}

function buildConfig(env) {
    const firebase = {
        apiKey: env.FIREBASE_API_KEY,
        authDomain: env.FIREBASE_AUTH_DOMAIN,
        projectId: env.FIREBASE_PROJECT_ID,
        storageBucket: env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
        appId: env.FIREBASE_APP_ID
    };

    if (typeof env.FIREBASE_MEASUREMENT_ID === 'string' && env.FIREBASE_MEASUREMENT_ID.trim() !== '') {
        firebase.measurementId = env.FIREBASE_MEASUREMENT_ID;
    }

    return {
        firebase
    };
}

function renderConfigJs(config) {
    const serialized = JSON.stringify(config, null, 4);
    return `'use strict';

(() => {
    const config = Object.freeze(${serialized});
    globalThis.__SAVE_RESUME_CONFIG__ = config;
})();
`;
}

function main() {
    const env = getCombinedEnv();
    const missingKeys = findMissingKeys(env);

    if (missingKeys.length > 0) {
        const message = [
            'Missing required Firebase environment variable(s):',
            `- ${missingKeys.join('\n- ')}`,
            '',
            'Create a .env file from .env.example and rerun npm run setup:config.'
        ].join('\n');

        console.error(message);
        process.exit(1);
    }

    const config = buildConfig(env);
    const fileContents = renderConfigJs(config);
    fs.writeFileSync(outputPath, fileContents, 'utf8');

    console.log(`Generated ${path.basename(outputPath)}.`);
}

main();
