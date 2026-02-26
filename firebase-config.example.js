'use strict';

(() => {
    const config = Object.freeze({
        firebase: Object.freeze({
            apiKey: 'replace-with-firebase-api-key',
            authDomain: 'replace-with-auth-domain',
            projectId: 'replace-with-project-id',
            storageBucket: 'replace-with-storage-bucket',
            messagingSenderId: 'replace-with-messaging-sender-id',
            appId: 'replace-with-app-id',
            measurementId: 'replace-with-optional-measurement-id'
        })
    });

    globalThis.__SAVE_RESUME_CONFIG__ = config;
})();
