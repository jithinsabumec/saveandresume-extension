const path = require('path');

module.exports = {
    mode: 'production',
    entry: './auth.js',
    output: {
        filename: 'auth_bundle.js',
        path: path.resolve(__dirname, '.'),
    },
    optimization: {
        minimize: false
    }
};
