// Test bootstrap: stubs XP server modules and globals, enables .es6 require via Babel
const Module = require('module');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request.startsWith('/lib/')) {
        return {};
    }
    return originalLoad.call(this, request, parent, isMain);
};

global.log = {
    debug() {
    },
    info() {
    },
    warning() {
    },
    error() {
    }
};
global.app = {name: 'com.enonic.app.nextxp', config: {}};

require('@babel/register')({
    extensions: ['.es6']
});
