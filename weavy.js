var jQueryVersion = {"options":{"loose":false,"includePrerelease":false},"loose":false,"raw":"3.3.1","major":3,"minor":3,"patch":1,"prerelease":[],"build":[],"version":"3.3.1"};/* global jQueryVersion */
if (jQuery && jQuery.fn && jQuery.fn.jquery && jQueryVersion) {
    try {
        var $version = jQuery.fn.jquery.split(".");
        var major = parseInt($version[0]);
        var minor = parseInt($version[1]);
        var patch = parseInt($version[2]);

        if (
            major < jQueryVersion.major || (
                major === jQueryVersion.major && (
                    minor < jQueryVersion.minor || (
                        minor === jQueryVersion.minor &&
                        patch < jQueryVersion.patch
                    )
                )
            )
        ) {
            console.error("Incorrect jQuery version: " + jQuery.fn.jquery + ", Required: " + jQueryVersion.version);
        } else {
            console.log("jQuery version:", jQuery.fn.jquery, "√")
        }


    } catch (e) {
        console.error("Could not check jQuery version");
    }
}
;
/* eslint-env commonjs, amd */

// UMD based on https://github.com/umdjs/umd/blob/master/templates/returnExports.js
// TODO: move to ES6 and transpiler

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['jquery'], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(require('jquery'));
    } else {
        // Browser globals (root is window)
        root.wvy = root.wvy || {};
        root.wvy.postal = root.wvy.postal || new factory(jQuery);
    }
}(typeof self !== 'undefined' ? self : this, function ($) {

    console.debug("postal.js", window.name);

    function eqObjects(a, b, skipLength) {
        if (!$.isPlainObject(a) || !$.isPlainObject(b)) {
            return false;
        }

        var aProps = Object.getOwnPropertyNames(a);
        var bProps = Object.getOwnPropertyNames(b);

        if (!skipLength && aProps.length !== bProps.length) {
            return false;
        }

        for (var i = 0; i < aProps.length; i++) {
            var propName = aProps[i];

            if (a[propName] !== b[propName]) {
                return false;
            }
        }

        return true;
    }

    var WeavyPostal = function () {
        /**
         *  Reference to this instance
         *  @lends WeavyPostal#
         */
        var postal = this;

        var inQueue = [];
        var parentQueue = [];
        var messageListeners = [];
        var contentWindows = new Set();
        var contentWindowsByWeavyId = new Map();
        var contentWindowOrigins = new WeakMap();
        var contentWindowNames = new WeakMap();
        var contentWindowWeavyIds = new WeakMap();

        var _whenLeader = $.Deferred();
        var _isLeader = null;

        var _parentWeavyId = null;
        var _parentWindow = null;
        var _parentOrigin = null;
        var _parentName = null;
        var _origin = extractOrigin(window.location.href);

        function extractOrigin(url) {
            return /^(https?:\/\/[^/]+)\//.exec(url)[1] || null;
        }

        function distributeMessage(e) {
            var fromSelf = e.source === window && e.origin === _origin;
            var fromParent = e.source === _parentWindow && e.origin === _parentOrigin;
            var fromFrame = contentWindowOrigins.has(e.source) && e.origin === contentWindowOrigins.get(e.source);

            if (fromSelf || fromParent || fromFrame) {

                var genericDistribution = !e.data.weavyId || e.data.weavyId === true;

                if (fromFrame && !e.data.windowName) {
                    e.data.windowName = contentWindowNames.get(e.source);
                }

                var messageName = e.data.name;
                if (messageName === "distribute") {
                    if (_isLeader) {
                        return;
                    }
                    e.data.name = e.data.distributeName;
                }

                //console.debug("wvy.postal:" + (window.name ? " " + window.name : "") + " message from", fromSelf && "self" || fromParent && "parent" || fromFrame && "frame " + e.data.windowName, e.data.name);

                messageListeners.forEach(function (listener) {
                    var matchingName = listener.name === messageName || listener.name === "message";
                    var genericListener = listener.selector === null;
                    var matchingWeavyId = listener.selector === e.data.weavyId;
                    var matchingDataSelector = $.isPlainObject(listener.selector) && eqObjects(listener.selector, e.data, true);

                    if (matchingName && (genericDistribution || genericListener || matchingWeavyId || matchingDataSelector)) {

                        listener.handler(e, e.data);

                        if (listener.once) {
                            off(listener.name, listener.selector, listener.handler);
                        }
                    }
                });
            }
        }

        window.addEventListener("message", function (e) {
            if (e.data.name && e.data.weavyId !== undefined) {
                switch (e.data.name) {
                    case "register-child":
                        if (!_parentWindow) {
                            if (!contentWindowWeavyIds.has(e.source)) {
                                console.debug("wvy.postal: child contentwindow not found, registering frame");
                                // get the real frame window
                                var frameWindow = Array.from(window.frames).filter(function (frame) {
                                    return frame === e.source;
                                }).pop();

                                if (frameWindow) {
                                    // get the frame element
                                    var frameElement, frameName;

                                    try {
                                        // get iframe by name, name may be blocked by cors
                                        frameElement = frameWindow.parent.document.getElementsByName(frameWindow.name)[0];
                                        frameName = frameWindow.name;
                                    } catch (e) {
                                        // get iframe by comparison
                                        frameElement = Array.from(frameWindow.parent.document.getElementsByTagName("iframe")).filter(function (iframe) {
                                            return iframe.contentWindow === frameWindow;
                                        }).pop();

                                        if (frameElement) {
                                            frameWindow = frameElement.contentWindow;

                                            if (frameElement.hasAttribute("name")) {
                                                frameName = frameElement.getAttribute("name");
                                            } else {
                                                frameName = null;
                                                console.warn("could not get name attribute of the iframe", frameElement)
                                            }
                                        }
                                    }

                                    if (frameElement && frameName) {
                                        var frameWeavyId = frameElement.dataset.weavyId;
                                        registerContentWindow(frameWindow, frameName, frameWeavyId);
                                    } else {
                                        var msg = "wvy.postal: did not register frame"
                                        if (!frameName) {
                                            msg += "; name attribute is missing";
                                        }
                                        if (!frameElement) {
                                            msg += "; frame not accessible";
                                        }
                                        console.warn(msg);
                                    }
                                }
                            }

                            try {
                                var weavyId = contentWindowWeavyIds.get(e.source);
                                var contentWindowName = contentWindowNames.get(e.source);

                                e.source.postMessage({
                                    name: "register-window",
                                    windowName: contentWindowName,
                                    weavyId: weavyId || true,
                                }, "*");
                            } catch (e) {
                                console.error("wvy.postal: Could not register frame window", weavyId, contentWindowName, e);
                            }
                        }
                        break;
                    case "register-window":
                        if (!_parentWindow) {
                            console.debug("wvy.postal: registering frame window", e.data.windowName);
                            _parentOrigin = e.origin;
                            _parentWindow = e.source;
                            _parentName = e.data.windowName;
                            _parentWeavyId = e.data.weavyId;
                        }

                        console.debug("wvy.postal: is not leader", window.name);
                        _isLeader = false;
                        _whenLeader.reject({ parentName: _parentName, parentWeavyId: _parentWeavyId, parentOrigin: _parentOrigin });

                        try {
                            e.source.postMessage({ name: "ready", windowName: e.data.windowName, weavyId: e.data.weavyId }, e.origin);
                        } catch (e) {
                            console.error("wvy.postal: register-window could not post back ready-message to source");
                        }

                        if (wvy.whenLoaded) {
                            wvy.whenLoaded.then(function () {
                                e.source.postMessage({ name: "load", windowName: e.data.windowName, weavyId: e.data.weavyId }, e.origin);
                            });
                        }

                        if (parentQueue.length) {
                            parentQueue.forEach(function (message) {
                                console.debug("wvy.postal: sending queued to parent:", message.name);

                                postToParent(message)
                            });
                            parentQueue = [];
                        }

                        if (inQueue.length) {
                            inQueue.forEach(function (messageEvent) {
                                distributeMessage(messageEvent)
                            });
                            inQueue = [];
                        }

                        break;
                    case "ready":
                        if (contentWindowsByWeavyId.has(e.data.weavyId) && contentWindowNames.has(e.source) && contentWindowsByWeavyId.get(e.data.weavyId).get(contentWindowNames.get(e.source))) {
                            contentWindowOrigins.set(e.source, e.origin);
                            distributeMessage(e);
                        }

                        break;
                    case "reload":
                        window.location.reload();
                        break;
                    default:
                        if (e.source === window || _parentWindow || contentWindowsByWeavyId.size) {
                            distributeMessage(e);
                        } else {
                            inQueue.push(e);
                        }

                        break;
                }
            }
        });

        function on(name, selector, handler) {
            if (typeof arguments[1] === "function") {
                // omit weavyId argument
                handler = arguments[1];
                selector = null;
            }
            messageListeners.push({ name: name, handler: handler, selector: selector });
        }

        function one(name, selector, handler) {
            if (typeof arguments[1] === "function") {
                // omit weavyId argument
                handler = arguments[1];
                selector = null;
            }
            messageListeners.push({ name: name, handler: handler, selector: selector, once: true });
        }

        function off(name, selector, handler) {
            if (typeof arguments[1] === "function") {
                // omit weavyId argument
                handler = arguments[1];
                selector = null;
            }
            messageListeners = messageListeners.filter(function (listener) {
                return !(name === listener.name && handler === listener.handler && (typeof selector === "string" && selector === listener.selector || $.isPlainObject(selector) && eqObjects(selector, listener.selector)));
            });
        }

        /**
         * Sends the id of a frame to the frame content scripts, so that the frame gets aware of which id it has.
         * The frame needs to have a unique name attribute.
         *
         * @category panels
         * @param {string} weavyId - The id of the group or entity which the contentWindow belongs to.
         * @param {Window} contentWindow - The frame window to send the data to.
         */
        function registerContentWindow(contentWindow, contentWindowName, weavyId) {
            try {
                if (!contentWindowName) {
                    console.error("wvy.postal: registerContentWindow() No valid contentWindow to register, must be a window and have a name.");
                    return;
                }
            } catch (e) {
                console.error("wvy.postal: registerContentWindow() cannot access contentWindowName")
            }

            if (!weavyId || weavyId === "true") {
                weavyId = true;
            }

            if (!contentWindowsByWeavyId.has(weavyId)) {
                contentWindowsByWeavyId.set(weavyId, new Map());
            }

            contentWindowsByWeavyId.get(weavyId).set(contentWindowName, contentWindow);
            contentWindows.add(contentWindow);
            contentWindowNames.set(contentWindow, contentWindowName);
            contentWindowWeavyIds.set(contentWindow, weavyId);
        }

        function unregisterWeavyId(weavyId) {
            if (contentWindowsByWeavyId.has(weavyId)) {
                contentWindowsByWeavyId.delete(weavyId);
            }
        }

        function unregisterContentWindow(windowName, weavyId) {
            if (contentWindowsByWeavyId.has(weavyId)) {
                contentWindowsByWeavyId.get(weavyId).delete(windowName);
                if (contentWindowsByWeavyId.get(weavyId).size === 0) {
                    contentWindowsByWeavyId.delete(weavyId);
                }
            }
        }

        function postToChildren(message, transfer) {
            if (typeof message !== "object" || !message.name) {
                console.error("wvy.postal: postToChildren() Invalid message format", message);
                return;
            }

            if (transfer === null) {
                // Chrome does not allow transfer to be null
                transfer = undefined;
            }

            message.distributeName = message.name;
            message.name = "distribute";
            message.weavyId = message.weavyId || true;

            contentWindows.forEach(function (contentWindow) {
                try {
                    contentWindow.postMessage(message, "*", transfer);
                } catch (e) {
                    console.warn("wvy.postal: postToChildren() could not distribute message to " + contentWindowNames.get(contentWindow))
                }
            })

        }

        function postToFrame(windowName, weavyId, message, transfer) {
            if (typeof message !== "object" || !message.name) {
                console.error("wvy.postal: postToFrame() Invalid message format", message);
                return;
            }

            if (transfer === null) {
                // Chrome does not allow transfer to be null
                transfer = undefined;
            }

            var contentWindow;
            try {
                contentWindow = contentWindowsByWeavyId.get(weavyId).get(windowName);
            } catch (e) {
                console.error("wvy.postal: postToFrame() Window not registered", weavyId, windowName);
            }

            if (contentWindow) {
                message.weavyId = weavyId;
                try {
                    contentWindow.postMessage(message, "*", transfer);
                } catch (e) {
                    console.error("wvy.postal: postToFrame() Could not post message to frame", windowName)
                }
            }
        }

        function postToSelf(message, transfer) {
            if (typeof message !== "object" || !message.name) {
                console.error("wvy.postal: postToSelf() Invalid message format", message);
                return;
            }

            if (transfer === null) {
                // Chrome does not allow transfer to be null
                transfer = undefined;
            }

            message.weavyId = _parentWeavyId || true;

            try {
                window.postMessage(message, extractOrigin(window.location.href) || "*", transfer);
            } catch (e) {
                console.error("wvy.postal: postToSelf() Could not post message to self");
            }
        }

        function postToParent(message, transfer, allowInsecure) {
            if (typeof message !== "object" || !message.name) {
                console.error("wvy.postal: postToParent() Invalid message format", message);
                return;
            }

            if (message.weavyId === undefined) {
                message.weavyId = _parentWeavyId;
            }

            if (transfer === null) {
                // Chrome does not allow transfer to be null
                transfer = undefined;
            }

            if (_parentWindow) {
                try {
                    if (_parentWindow && _parentWindow !== window) {
                        _parentWindow.postMessage(message, _parentOrigin || "*", transfer);
                    }
                } catch (e) {
                    console.error("wvy.postal: postToParent() Error posting message", message.name, e);
                }
            } else if (allowInsecure) {
                var parents = [];

                // Find all parent windows
                var nextWindow = window;
                while (nextWindow.top !== nextWindow) {
                    nextWindow = nextWindow.opener || nextWindow.parent;
                    parents.push(nextWindow);
                }

                parents.forEach(function (parent) {
                    try {
                        parent.postMessage(message, "*", transfer);
                        console.debug("wvy.postal: postToParent() Posted insecure message", message.name)
                    } catch (e) {
                        console.error("wvy.postal: postToParent() Error posting insecure message", message.name, e);
                    }
                });

            } else {
                console.debug("wvy.postal: postToParent() queueing to parent", message.name);
                parentQueue.push(message);
            }

        }

        function postToSource(e, message, transfer) {
            if (e.source && e.data.weavyId !== undefined) {
                var fromSelf = e.source === window.self && e.origin === _origin;
                var fromParent = e.source === _parentWindow && e.origin === _parentOrigin;
                var fromFrame = contentWindowOrigins.has(e.source) && e.origin === contentWindowOrigins.get(e.source);

                if (transfer === null) {
                    // Chrome does not allow transfer to be null
                    transfer = undefined;
                }

                if (fromSelf || fromParent || fromFrame) {
                    message.weavyId = e.data.weavyId;

                    try {
                        e.source.postMessage(message, e.origin, transfer);
                    } catch (e) {
                        console.error("wvy.postal: postToSource() Could not post message back to source");
                    }
                }
            }
        }

        function checkForParent() {
            var parents = [];

            // Find all parent windows
            var nextWindow = window.self;
            while (nextWindow.top !== nextWindow) {
                nextWindow = nextWindow.opener || nextWindow.parent;
                parents.unshift(nextWindow);
            }

            parents.forEach(function (parent) {
                try {
                    parent.postMessage({ name: "register-child", weavyId: true }, "*");
                    console.debug("wvy.postal: checking for parent")
                } catch (e) {
                    console.error("wvy.postal: Error checking for parent", e);
                }
            });

            requestAnimationFrame(function () {
                window.setTimeout(function () {
                    if (_whenLeader.state() === "pending") {
                        console.debug("wvy.postal: is leader");
                        _isLeader = true;
                        _whenLeader.resolve();
                    }
                }, parents.length ? 2000 : 100);
            });
        }

        $(document).on("click", "[data-weavy-event]", function (e) {
            e.preventDefault();

            var name = $(this).data("weavy-name");

            postToParent.call(postal, { name: name });
        });

        $(document).on("submit", "[data-weavy-event-notify]", function (e) {
            var name = $(this).data("weavyEventNotify");
            postToParent.call(postal, { name: name });
        });

        this.on = on;
        this.one = one;
        this.off = off;
        this.registerContentWindow = registerContentWindow;
        this.unregister = unregisterContentWindow;
        this.unregisterAll = unregisterWeavyId;
        this.postToFrame = postToFrame;
        this.postToParent = postToParent;
        this.postToSelf = postToSelf;
        this.postToSource = postToSource;
        this.postToChildren = postToChildren;
        this.extractOrigin = extractOrigin;
        this.whenLeader = _whenLeader.promise();

        Object.defineProperty(this, "isLeader", {
            get: function () { return _isLeader; }
        });
        Object.defineProperty(this, "parentWeavyId", {
            get: function () { return _parentWeavyId; }
        });
        Object.defineProperty(this, "parentName", {
            get: function () { return _parentName; }
        });
        Object.defineProperty(this, "parentOrigin", {
            get: function () { return _parentOrigin; }
        });

        checkForParent();
    };


    return new WeavyPostal();
}));


/**
 * @external Promise
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
 */

/**
 * @external jqXHR
 * @see http://api.jquery.com/jQuery.ajax/#jqXHR
 */

/**
 * @external jqAjaxSettings
 * @see http://api.jquery.com/jquery.ajax/#jQuery-ajax-settings
 */


;
/* eslint-env commonjs, amd */

// UMD based on https://github.com/umdjs/umd/blob/master/templates/returnExports.js
// TODO: move to ES6 and transpiler

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['jquery'], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(require('jquery'));
    } else {
        // Browser globals (root is window)
        root.wvy = root.wvy || {};
        root.wvy.authentication = root.wvy.authentication || new factory(jQuery);
    }
}(typeof self !== 'undefined' ? self : this, function ($) {

    console.debug("authentication.js", window.name);

    var userUrl = "/client/user";
    var ssoUrl = "/client/sign-in";
    var signOutUrl = "/client/sign-out";

    // MULTI AUTHENTICATION HANDLING
    var authentications = this;
    var _authentications = new Map();

    // JSON HELPERS
    var toCamel = function (s) {
        // from PascalCase
        s = s[0].toLowerCase() + s.substring(1);

        // from snake_case and spinal-case
        return s.replace(/([-_][a-z])/ig, function ($1) {
            return $1.toUpperCase()
                .replace('-', '')
                .replace('_', '');
        });
    };

    var keysToCamel = function (o) {
        if ($.isPlainObject(o)) {
            const n = {};

            Object.keys(o)
                .forEach(function (k) {
                    n[toCamel(k)] = keysToCamel(o[k]);
                });

            return n;
        } else if ($.isArray(o)) {
            return o.map(function (i) {
                return keysToCamel(i);
            });
        }

        return o;
    };

    var WeavyAuthentication = function (baseUrl) {

        /**
         *  Reference to this instance
         *  @lends WeavyAuthentication#
         */
        var weavyAuthentication = this;

        baseUrl = baseUrl || "";

        if (baseUrl) {
            // Remove trailing slash
            baseUrl = /\/$/.test(baseUrl) ? baseUrl.slice(0, -1) : baseUrl;
        }

        function resolveUrl(url, resolveBaseUrl) {
            var https = WeavyAuthentication.defaults.https || "adaptive";
            resolveBaseUrl = resolveBaseUrl || baseUrl || "";

            if (typeof url === "string" && https !== "nochange") {
                // Check baseUrl and url protocol
                if (resolveBaseUrl && !/^[0-9a-zA-Z+\-.]*:/.test(url)) {
                    // Remove beginning slash
                    if (url.indexOf("/") === 0) {
                        url = url.substr(1);
                    }
                    // Add trailing slash
                    if (resolveBaseUrl.lastIndexOf("/") !== resolveBaseUrl.length - 1) {
                        resolveBaseUrl += "/";
                    }
                    url = resolveBaseUrl + url;
                }

                // Check protocol
                if (https === "enforce") {
                    url = url.replace(/^http:/, "https:");
                } else if (https === "adaptive") {
                    url = url.replace(/^http:/, window.location.protocol);
                }
            }
            return url;
        }

        var _events = [];

        var _user = null;

        // Is the user established?
        var _isAuthenticated = null;
        var _whenAuthenticated = $.Deferred();
        var _whenAuthorized = $.Deferred();

        var _isUpdating = false;
        var _isNavigating = false;

        window.addEventListener('beforeunload', function () {
            _isNavigating = true;
        });

        window.addEventListener('turbolinks:request-start', function () {
            _isNavigating = true;
        });

        window.addEventListener('turbolinks:load', function () {
            _isNavigating = false;

            // If the user was changed on page load, process the user instantly
            if (_user && wvy.context && wvy.context.user && _user.id !== wvy.context.user) {
                processUser({ id: wvy.context.user }, "turbolinks:load/wvy.context.user");
            }
        });


        /**
         * Checks if the provided or authenticated user is signed in
         * 
         * @param {any} [user] - Optional user to check
         */
        function isAuthorized(user) {
            if (user) {
                return user.id && user.id !== -1 || false;
            }
            return _user && _user.id && _user.id !== -1 || false;
        }

        // JWT
        var _jwt;
        var _jwtProvider;

        function setJwt(jwt) {
            console.debug("wvy.authentication: configuring jwt");
            _jwt = null;
            _jwtProvider = jwt;
        }

        /**
         * Returns the current jwt token; either the specified jwt string or as a result from the supplied function.
         * @param {boolean} [refresh=false] - Set to true if you want to call the host for a new token.
         * @returns {external:Promise}
         */
        function getJwt(refresh) {
            return new Promise(function (resolve, reject) {
                if (_jwt && !refresh) {
                    // jwt already set, return it
                    resolve(_jwt);
                    return;
                }

                if (refresh) {
                    // reset jwt on refresh
                    _jwt = null;
                }

                if (_jwtProvider === undefined) {
                    // no jwt provided, return nothing
                    resolve(false);
                    return;
                }

                if (typeof _jwtProvider === "string") {
                    _jwt = _jwtProvider;
                    resolve(_jwt);
                } else if (typeof _jwtProvider === "function") {
                    var resolvedProvider = _jwtProvider();

                    if (typeof resolvedProvider.then === "function") {
                        return resolvedProvider.then(function (token) {
                            _jwt = token;
                            resolve(_jwt);
                        }, function () {
                            reject("failed to get token from the jwt provider promise");
                        });
                    } else if (typeof resolvedProvider === "string") {
                        _jwt = resolvedProvider;
                        resolve(_jwt);
                    } else {
                        reject("failed to get token from the jwt provider function");
                    }
                } else {
                    reject("jwt option must be a string or a function that returns a promise");
                }
            });
        }

        function init(jwt) {
            if (_isAuthenticated === null) {
                if (typeof jwt === "string" || typeof jwt === "function") {
                    setJwt(jwt);
                }

                // Authenticate
                if (_jwtProvider !== undefined) {
                    console.log("wvy.authentication: authenticate by jwt")
                    // If JWT is defined, it should always be processed
                    signIn();
                } else if (wvy.context && wvy.context.user) {
                    // If user is defined in wvy.context, user is already signed in
                    setUser({ id: wvy.context.user }, "init/wvy.context.user");
                } else {
                    // Check for current user state
                    updateUserState("authenticate()");
                }
            }

            // Listen on messages from parent?
            wvy.postal.on("message", onChildMessageReceived);
            wvy.postal.on("distribute", onParentMessageReceived);

            console.log("wvy.authentication: init", baseUrl || window.name || "self");

            wvy.connection.get(baseUrl).on("authenticate.weavy.rtmweavy", function () {
                console.debug("wvy.authentication:" + (window.name ? " " + window.name : "") + " authenticate.weavy -> updateUserState");
                updateUserState("authenticate.weavy.rtmweavy");
            });

            return _whenAuthenticated.promise();
        }

        function setUser(user, originSource) {
            if (user && user.id) {
                if (_user && user && _user.id !== user.id) {
                    console.debug("wvy.authentication:" + (window.name ? " " + window.name : "") + " setUser", user.id, originSource);
                }
                _user = user;
                if (wvy.context) {
                    wvy.context.user = user.id;
                }
                _isAuthenticated = true;
                if (isAuthorized(user)) {
                    _whenAuthorized.resolve();
                } else {
                    if (_whenAuthorized.state() !== "pending") {
                        _whenAuthorized = $.Deferred();
                    }
                }

                _whenAuthenticated.resolve(user);
            } else {
                // No valid user, reset states
                _user = null;
                if (wvy.context) {
                    wvy.context.user = null;
                }
                _isAuthenticated = false;

                _whenAuthorized.reject();
                _whenAuthorized = $.Deferred();
            }
        }

        function alert(message, type) {
            if (wvy.alert && !_isNavigating) {
                wvy.alert.alert(type || "info", message, null, "wvy-authentication-alert");
            }
        }

        // EVENTS

        function on(event, handler) {
            event = event.indexOf(".weavy") === -1 ? event + ".weavy" : event;
            _events.push([event, handler]);
            $(weavyAuthentication).on(event, null, null, handler);
        }

        function off(event, handler) {
            event = event.indexOf(".weavy") === -1 ? event + ".weavy" : event;

            _events = _events.filter(function (eventHandler) {
                if (eventHandler[0] === event && eventHandler[1] === handler) {
                    $(weavyAuthentication).off(event, null, handler);
                    return false;
                } else {
                    return true;
                }
            })

        }

        function triggerEvent(name) {
            var event = $.Event(name);

            // trigger event (with json object instead of string), handle any number of json objects passed from hub (args)
            var argumentArray = [].slice.call(arguments, 1);
            var data = argumentArray.map(function (a) {
                if (a && !$.isArray(a) && !$.isPlainObject(a)) {
                    try {
                        return JSON.parse(a);
                    } catch (e) {
                        console.warn("wvy.authentication:" + (window.name ? " " + window.name : "") + " could not parse event data;", name);
                    }
                }
                return a;
            });

            var eventResult = $(weavyAuthentication).triggerHandler(event, data);
            var eventIsPrevented = event.isDefaultPrevented() || eventResult === false;

            triggerToChildren("distribute-authentication-event", name, data);

            return eventIsPrevented ? false : eventResult;
        }

        // trigger a message distribute
        function triggerToChildren(name, eventName, data) {
            try {
                wvy.postal.postToChildren({ name: name, eventName: eventName, data: data }, null);
            } catch (e) {
                console.error("wvy.authentication:" + (window.name ? " " + window.name : "") + " could not distribute authentication message to children", { name: name, eventName: eventName }, e);
            }
        }

        // AUTHENTICATION

        /**
         * Sign in using Single Sign On JWT token
         */
        function signIn() {
            return wvy.postal.whenLeader.always(validateJwt);
        }

        function signOut() {
            var authUrl = resolveUrl(signOutUrl);

            triggerEvent("clear-user");

            $.ajax(authUrl, {
                crossDomain: true,
                method: "GET",
                xhrFields: {
                    withCredentials: true
                }
            }).fail(function () {
                console.warn("wvy.authentication:" + (window.name ? " " + window.name : "") + " signOut request fail");
            }).always(function () {
                console.debug("wvy.authentication: signout ajax -> processing user");

                processUser({ id: -1 }, "signOut()");
            });
        }

        function processUser(user, originSource) {
            // Default state when user is unauthenticated or has not changed
            var state = "updated";

            var reloadLink = ' <a href="#" onclick="location.reload(); return false;">Reload</a>';

            if (user && user.id) {
                if (_isAuthenticated) {
                    if (isAuthorized()) {
                        // When signed in
                        if (user && user.id === -1) {
                            console.log("wvy.authentication: signed-out");
                            alert("You have been signed out." + reloadLink);
                            // User signed out
                            state = "signed-out";
                        } else if (user && user.id !== _user.id) {
                            console.log("wvy.authentication: changed-user");
                            alert("The signed in user has changed." + reloadLink)
                            // User changed
                            state = "changed-user";
                        }
                    } else {
                        // When signed out
                        if (user && user.id !== -1) {
                            console.log("wvy.authentication: signed-in", originSource);

                            // Show a message if the user hasn't loaded a new page
                            if (wvy.context && wvy.context.user && user.id !== wvy.context.user) {
                                alert("You have signed in." + reloadLink);
                            }

                            // User signed in
                            state = "signed-in";
                        }
                    }
                }

                setUser(user, originSource || "processUser()");
                triggerEvent("user", { state: state, authorized: isAuthorized(user), user: user });
            } else {
                // No valid user state
                console.error("wvy.authentication: user-error", originSource || "");

                setUser(null, originSource || "processUser()");
                triggerEvent("clear-user");

                var eventResult = triggerEvent("user", { state: "user-error", authorized: false, user: user });
                if (eventResult !== false) {
                    wvy.postal.whenLeader.then(function () {
                        alert("Authentication error." + reloadLink, "danger");
                    });
                }
            }

            _isUpdating = false;
        }

        function updateUserState(originSource) {
            if (!_isUpdating) {
                _isUpdating = true;
                wvy.postal.whenLeader.then(function () {
                    console.debug("wvy.authentication:" + (window.name ? " " + window.name : "") + " whenLeader => updateUserState");

                    if (_whenAuthenticated.state() !== "pending") {
                        _whenAuthenticated = $.Deferred();
                    }
                    if (_whenAuthorized.state() !== "pending") {
                        _whenAuthorized = $.Deferred();
                    }

                    var authSettings = {
                        url: resolveUrl(userUrl),
                        method: "POST",
                        contentType: "application/json",
                        crossDomain: true,
                        dataType: "json",
                        data: {},
                        dataFilter: function (data, dataType) {
                            return dataType === "json" ? JSON.stringify(keysToCamel(JSON.parse(data))) : data;
                        },
                        xhrFields: {
                            withCredentials: true
                        },
                        headers: {
                            // https://stackoverflow.com/questions/8163703/cross-domain-ajax-doesnt-send-x-requested-with-header
                            "X-Requested-With": "XMLHttpRequest"
                        }
                    };

                    getJwt().then(function (token) {
                        if (typeof token === "string") {
                            authSettings.data = JSON.stringify({ jwt: token });
                        }

                        $.ajax(authSettings).then(null, function (xhr, status, error) {
                            if (token !== undefined && xhr.status === 401) {
                                console.warn("wvy.authentication: JWT failed, trying again");
                                return getJwt(true).then(function (token) {
                                    authSettings.data.jwt = token;
                                    return $.ajax(authSettings);
                                })
                            }
                        }).then(function (actualUser) {
                            console.debug("wvy.authentication: updateUserState ajax -> processing user")
                            processUser(actualUser, "updateUserState," + originSource);
                        }, function () {
                            console.warn("wvy.authentication:" + (window.name ? " " + window.name : "") + " updateUserState request fail");
                            console.debug("wvy.authentication: updateUserState ajax xhr fail -> processing user");
                            processUser({ id: null }, "updateUserState," + originSource);
                        });
                    });
                }).catch(function () {
                    wvy.postal.postToParent({ name: "request:user" });
                });
            }

            return _whenAuthenticated.promise();
        }

        function validateJwt(refresh) {
            var whenSSO = $.Deferred();
            var authUrl = resolveUrl(ssoUrl);

            console.log("wvy.authentication: validating jwt");

            if (!refresh) {
                triggerEvent("signing-in");
            }

            return getJwt(refresh).then(function (jwt) {
                return $.ajax(authUrl, {
                    crossDomain: true,
                    contentType: "application/json",
                    method: "GET",
                    xhrFields: {
                        withCredentials: true
                    },
                    // https://stackoverflow.com/questions/8163703/cross-domain-ajax-doesnt-send-x-requested-with-header
                    headers: {
                        "Authorization": "Bearer " + jwt,
                        "X-Requested-With": "XMLHttpRequest"
                    }
                }).then(function (ssoUser) {
                    processUser(ssoUser);
                    return whenSSO.resolve(ssoUser);
                }, function (xhr, status, error) {

                    if (xhr.status === 401 && !refresh) {
                        console.warn("wvy.authentication: JWT failed, trying again");
                        return validateJwt(true);
                    } else {
                        triggerEvent("authentication-error", { method: "jwt", status: xhr.status, message: xhr.responseJSON && xhr.responseJSON.message ? xhr.responseJSON.message : error });
                        console.error("wvy.authentication:" + (window.name ? " " + window.name : "") + " sign in with JWT token failed", xhr.status, xhr.responseJSON && xhr.responseJSON.message ? "\n" + xhr.responseJSON.message : error);
                        processUser({ id: null });
                        return whenSSO.reject({ id: null });
                    }
                });
            })
        }

        // REALTIME CROSS WINDOW MESSAGE
        // handle cross frame events from rtm
        var onChildMessageReceived = function (e) {
            var msg = e.data;
            switch (msg.name) {
                case "request:user":
                    _whenAuthenticated.then(function () {
                        wvy.postal.postToSource(e, { name: "user", user: _user });
                    })
                    break;
                default:
                    return;
            }

        };

        var onParentMessageReceived = function (e) {
            var msg = e.data;
            switch (msg.name) {
                case "user":
                    console.debug("wvy.authentication: parentMessage user -> processing user");
                    processUser(msg.user, "parentMessage:user");
                    break;
                case "distribute-authentication-event":
                    var name = msg.eventName;
                    var event = $.Event(name);
                    var data = msg.data;

                    // Extract array with single value
                    if ($.isArray(data) && data.length === 1) {
                        data = data[0];
                    }

                    if (name === "user") {
                        console.debug("wvy.authentication: parentMessage distribute-authentication-event user -> processing user");
                        processUser(data.user, "distribute-authentication-event:user");
                    } else {
                        console.debug("wvy.authentication:" + (window.name ? " " + window.name : "") + " triggering received distribute-event", name);
                        $(weavyAuthentication).triggerHandler(event, msg.data);
                    }

                    break;
                default:
                    return;
            }

        };


        function destroy() {
            _isAuthenticated = null;
            _user = null;

            _events.forEach(function (eventHandler) {
                var name = eventHandler[0], handler = eventHandler[1];
                $(weavyAuthentication).off(name, null, handler);
            });
            _events = [];
        }

        return {
            init: init,
            isAuthorized: isAuthorized,
            isAuthenticated: function () { return _isAuthenticated === true; },
            whenAuthenticated: function () { return _whenAuthenticated.promise(); },
            whenAuthorized: function () { return _whenAuthorized.promise(); },
            on: on,
            off: off,
            signIn: signIn,
            signOut: signOut,
            setJwt: setJwt,
            getJwt: getJwt,
            updateUserState: updateUserState,
            user: function () { return _user },
            destroy: destroy
        };
    };

    WeavyAuthentication.defaults = {
        https: "adaptive"
    };

    authentications.get = function (url) {
        var sameOrigin = false;
        var urlExtract = url && /^(https?:\/(\/[^/]+)+)\/?$/.exec(url)
        if (urlExtract) {
            sameOrigin = window.location.origin === urlExtract[1];
            url = urlExtract[1];
        }
        url = (sameOrigin ? "" : url) || "";
        if (_authentications.has(url)) {
            return _authentications.get(url);
        } else {
            var authentication = new WeavyAuthentication(url);
            _authentications.set(url, authentication);
            return authentication;
        }
    };

    authentications.remove = function (url) {
        url = url || "";
        try {
            var authentication = _authentications.get(url);
            if (authentication && authentication.destroy) {
                authentication.destroy();
            }
            _authentications.delete(url);
        } catch (e) {
            console.error("Could not remove authentication", url, e);
        }
    };

    // expose wvy.connection.default. self initiatied upon access and no other connections are active 
    Object.defineProperty(authentications, "default", {
        get: function () {
            if (_authentications.has("")) {
                return _authentications.get("");
            } else {
                var authentication = authentications.get();

                $(function () {
                    setTimeout(function () {
                        if (_authentications.size === 1) {
                            authentication.init();
                        }
                    }, 1);
                });

                return authentication;
            }
        }
    });

    // Bridge for simple syntax and backward compatibility with the mobile apps
    Object.defineProperty(authentications, "on", {
        get: function () {
            return authentications.default.on;
        }
    });

    // Bridge for simple syntax
    Object.defineProperty(authentications, "sso", {
        get: function () {
            return authentications.default.sso;
        }
    });
}));


/**
 * @external Promise
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
 */

/**
 * @external jqXHR
 * @see http://api.jquery.com/jQuery.ajax/#jqXHR
 */

/**
 * @external jqAjaxSettings
 * @see http://api.jquery.com/jquery.ajax/#jQuery-ajax-settings
 */
;
/* jquery.signalR.core.js */
/*global window:false */
/*!
 * ASP.NET SignalR JavaScript Library 2.4.0
 * http://signalr.net/
 *
 * Copyright (c) .NET Foundation. All rights reserved.
 * Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *
 * CHANGES BY WEAVY:
 * changed window.jQuery to scoped jQuery 
 * changed window.encodeURIComponent() to encodeURIComponent() (because of issue with Firefox browser extension)
 * adedd local variable asyncLocal to ajaxAbort (as a workaround because our minification fails otherwise)
 * stop early return after subsequent calls to start, we need to do check for crossdomain and set connection.withCredentials
 */
(function ($, window, undefined) {

    var resources = {
        nojQuery: "jQuery was not found. Please ensure jQuery is referenced before the SignalR client JavaScript file.",
        noTransportOnInit: "No transport could be initialized successfully. Try specifying a different transport or none at all for auto initialization.",
        errorOnNegotiate: "Error during negotiation request.",
        stoppedWhileLoading: "The connection was stopped during page load.",
        stoppedWhileNegotiating: "The connection was stopped during the negotiate request.",
        errorParsingNegotiateResponse: "Error parsing negotiate response.",
        errorRedirectionExceedsLimit: "Negotiate redirection limit exceeded.",
        errorDuringStartRequest: "Error during start request. Stopping the connection.",
        errorFromServer: "Error message received from the server: '{0}'.",
        stoppedDuringStartRequest: "The connection was stopped during the start request.",
        errorParsingStartResponse: "Error parsing start response: '{0}'. Stopping the connection.",
        invalidStartResponse: "Invalid start response: '{0}'. Stopping the connection.",
        protocolIncompatible: "You are using a version of the client that isn't compatible with the server. Client version {0}, server version {1}.",
        aspnetCoreSignalrServer: "Detected a connection attempt to an ASP.NET Core SignalR Server. This client only supports connecting to an ASP.NET SignalR Server. See https://aka.ms/signalr-core-differences for details.",
        sendFailed: "Send failed.",
        parseFailed: "Failed at parsing response: {0}",
        longPollFailed: "Long polling request failed.",
        eventSourceFailedToConnect: "EventSource failed to connect.",
        eventSourceError: "Error raised by EventSource",
        webSocketClosed: "WebSocket closed.",
        pingServerFailedInvalidResponse: "Invalid ping response when pinging server: '{0}'.",
        pingServerFailed: "Failed to ping server.",
        pingServerFailedStatusCode: "Failed to ping server.  Server responded with status code {0}, stopping the connection.",
        pingServerFailedParse: "Failed to parse ping server response, stopping the connection.",
        noConnectionTransport: "Connection is in an invalid state, there is no transport active.",
        webSocketsInvalidState: "The Web Socket transport is in an invalid state, transitioning into reconnecting.",
        reconnectTimeout: "Couldn't reconnect within the configured timeout of {0} ms, disconnecting.",
        reconnectWindowTimeout: "The client has been inactive since {0} and it has exceeded the inactivity timeout of {1} ms. Stopping the connection.",
        jsonpNotSupportedWithAccessToken: "The JSONP protocol does not support connections that require a Bearer token to connect, such as the Azure SignalR Service."
    };

    if (typeof ($) !== "function") {
        // no jQuery!
        throw new Error(resources.nojQuery);
    }

    var signalR,
        _connection,
        _pageLoaded = (window.document.readyState === "complete"),
        _pageWindow = $(window),
        _negotiateAbortText = "__Negotiate Aborted__",
        events = {
            onStart: "onStart",
            onStarting: "onStarting",
            onReceived: "onReceived",
            onError: "onError",
            onConnectionSlow: "onConnectionSlow",
            onReconnecting: "onReconnecting",
            onReconnect: "onReconnect",
            onStateChanged: "onStateChanged",
            onDisconnect: "onDisconnect"
        },
        ajaxDefaults = {
            processData: true,
            timeout: null,
            async: true,
            global: false,
            cache: false
        },
        log = function (msg, logging) {
            if (logging === false) {
                return;
            }
            var m;
            if (typeof (window.console) === "undefined") {
                return;
            }
            m = "[" + new Date().toTimeString() + "] SignalR: " + msg;
            if (window.console.debug) {
                window.console.debug(m);
            } else if (window.console.log) {
                window.console.log(m);
            }
        },

        changeState = function (connection, expectedState, newState) {
            if (expectedState === connection.state) {
                connection.state = newState;

                $(connection).triggerHandler(events.onStateChanged, [{ oldState: expectedState, newState: newState }]);
                return true;
            }

            return false;
        },

        isDisconnecting = function (connection) {
            return connection.state === signalR.connectionState.disconnected;
        },

        supportsKeepAlive = function (connection) {
            return connection._.keepAliveData.activated &&
                connection.transport.supportsKeepAlive(connection);
        },

        configureStopReconnectingTimeout = function (connection) {
            var stopReconnectingTimeout,
                onReconnectTimeout;

            // Check if this connection has already been configured to stop reconnecting after a specified timeout.
            // Without this check if a connection is stopped then started events will be bound multiple times.
            if (!connection._.configuredStopReconnectingTimeout) {
                onReconnectTimeout = function (connection) {
                    var message = signalR._.format(signalR.resources.reconnectTimeout, connection.disconnectTimeout);
                    connection.log(message);
                    $(connection).triggerHandler(events.onError, [signalR._.error(message, /* source */ "TimeoutException")]);
                    connection.stop(/* async */ false, /* notifyServer */ false);
                };

                connection.reconnecting(function () {
                    var connection = this;

                    // Guard against state changing in a previous user defined even handler
                    if (connection.state === signalR.connectionState.reconnecting) {
                        stopReconnectingTimeout = window.setTimeout(function () { onReconnectTimeout(connection); }, connection.disconnectTimeout);
                    }
                });

                connection.stateChanged(function (data) {
                    if (data.oldState === signalR.connectionState.reconnecting) {
                        // Clear the pending reconnect timeout check
                        window.clearTimeout(stopReconnectingTimeout);
                    }
                });

                connection._.configuredStopReconnectingTimeout = true;
            }
        };

    signalR = function (url, qs, logging) {
        /// <summary>Creates a new SignalR connection for the given url</summary>
        /// <param name="url" type="String">The URL of the long polling endpoint</param>
        /// <param name="qs" type="Object">
        ///     [Optional] Custom querystring parameters to add to the connection URL.
        ///     If an object, every non-function member will be added to the querystring.
        ///     If a string, it's added to the QS as specified.
        /// </param>
        /// <param name="logging" type="Boolean">
        ///     [Optional] A flag indicating whether connection logging is enabled to the browser
        ///     console/log. Defaults to false.
        /// </param>

        return new signalR.fn.init(url, qs, logging);
    };

    signalR._ = {
        defaultContentType: "application/x-www-form-urlencoded; charset=UTF-8",

        ieVersion: (function () {
            var version,
                matches;

            if (window.navigator.appName === 'Microsoft Internet Explorer') {
                // Check if the user agent has the pattern "MSIE (one or more numbers).(one or more numbers)";
                matches = /MSIE ([0-9]+\.[0-9]+)/.exec(window.navigator.userAgent);

                if (matches) {
                    version = window.parseFloat(matches[1]);
                }
            }

            // undefined value means not IE
            return version;
        })(),

        error: function (message, source, context) {
            var e = new Error(message);
            e.source = source;

            if (typeof context !== "undefined") {
                e.context = context;
            }

            return e;
        },

        transportError: function (message, transport, source, context) {
            var e = this.error(message, source, context);
            e.transport = transport ? transport.name : undefined;
            return e;
        },

        format: function () {
            /// <summary>Usage: format("Hi {0}, you are {1}!", "Foo", 100) </summary>
            var s = arguments[0];
            for (var i = 0; i < arguments.length - 1; i++) {
                s = s.replace("{" + i + "}", arguments[i + 1]);
            }
            return s;
        },

        firefoxMajorVersion: function (userAgent) {
            // Firefox user agents: http://useragentstring.com/pages/Firefox/
            var matches = userAgent.match(/Firefox\/(\d+)/);
            if (!matches || !matches.length || matches.length < 2) {
                return 0;
            }
            return parseInt(matches[1], 10 /* radix */);
        },

        configurePingInterval: function (connection) {
            var config = connection._.config,
                onFail = function (error) {
                    $(connection).triggerHandler(events.onError, [error]);
                };

            if (config && !connection._.pingIntervalId && config.pingInterval) {
                connection._.pingIntervalId = window.setInterval(function () {
                    signalR.transports._logic.pingServer(connection).fail(onFail);
                }, config.pingInterval);
            }
        }
    };

    signalR.events = events;

    signalR.resources = resources;

    signalR.ajaxDefaults = ajaxDefaults;

    signalR.changeState = changeState;

    signalR.isDisconnecting = isDisconnecting;

    signalR.connectionState = {
        connecting: 0,
        connected: 1,
        reconnecting: 2,
        disconnected: 4
    };

    signalR.hub = {
        start: function () {
            // This will get replaced with the real hub connection start method when hubs is referenced correctly
            throw new Error("SignalR: Error loading hubs. Ensure your hubs reference is correct, e.g. <script src='/signalr/js'></script>.");
        }
    };

    // .on() was added in version 1.7.0, .load() was removed in version 3.0.0 so we fallback to .load() if .on() does
    // not exist to not break existing applications
    if (typeof _pageWindow.on == "function") {
        _pageWindow.on("load", function () { _pageLoaded = true; });
    }
    else {
        _pageWindow.load(function () { _pageLoaded = true; });
    }

    function validateTransport(requestedTransport, connection) {
        /// <summary>Validates the requested transport by cross checking it with the pre-defined signalR.transports</summary>
        /// <param name="requestedTransport" type="Object">The designated transports that the user has specified.</param>
        /// <param name="connection" type="signalR">The connection that will be using the requested transports.  Used for logging purposes.</param>
        /// <returns type="Object" />

        if ($.isArray(requestedTransport)) {
            // Go through transport array and remove an "invalid" tranports
            for (var i = requestedTransport.length - 1; i >= 0; i--) {
                var transport = requestedTransport[i];
                if ($.type(transport) !== "string" || !signalR.transports[transport]) {
                    connection.log("Invalid transport: " + transport + ", removing it from the transports list.");
                    requestedTransport.splice(i, 1);
                }
            }

            // Verify we still have transports left, if we dont then we have invalid transports
            if (requestedTransport.length === 0) {
                connection.log("No transports remain within the specified transport array.");
                requestedTransport = null;
            }
        } else if (!signalR.transports[requestedTransport] && requestedTransport !== "auto") {
            connection.log("Invalid transport: " + requestedTransport.toString() + ".");
            requestedTransport = null;
        } else if (requestedTransport === "auto" && signalR._.ieVersion <= 8) {
            // If we're doing an auto transport and we're IE8 then force longPolling, #1764
            return ["longPolling"];

        }

        return requestedTransport;
    }

    function getDefaultPort(protocol) {
        if (protocol === "http:") {
            return 80;
        } else if (protocol === "https:") {
            return 443;
        }
    }

    function addDefaultPort(protocol, url) {
        // Remove ports  from url.  We have to check if there's a / or end of line
        // following the port in order to avoid removing ports such as 8080.
        if (url.match(/:\d+$/)) {
            return url;
        } else {
            return url + ":" + getDefaultPort(protocol);
        }
    }

    function ConnectingMessageBuffer(connection, drainCallback) {
        var that = this,
            buffer = [];

        that.tryBuffer = function (message) {
            if (connection.state === $.signalR.connectionState.connecting) {
                buffer.push(message);

                return true;
            }

            return false;
        };

        that.drain = function () {
            // Ensure that the connection is connected when we drain (do not want to drain while a connection is not active)
            if (connection.state === $.signalR.connectionState.connected) {
                while (buffer.length > 0) {
                    drainCallback(buffer.shift());
                }
            }
        };

        that.clear = function () {
            buffer = [];
        };
    }

    signalR.fn = signalR.prototype = {
        init: function (url, qs, logging) {
            var $connection = $(this);

            this.url = url;
            this.qs = qs;
            this.lastError = null;
            this._ = {
                keepAliveData: {},
                connectingMessageBuffer: new ConnectingMessageBuffer(this, function (message) {
                    $connection.triggerHandler(events.onReceived, [message]);
                }),
                lastMessageAt: new Date().getTime(),
                lastActiveAt: new Date().getTime(),
                beatInterval: 5000, // Default value, will only be overridden if keep alive is enabled,
                beatHandle: null,
                totalTransportConnectTimeout: 0 // This will be the sum of the TransportConnectTimeout sent in response to negotiate and connection.transportConnectTimeout
            };
            if (typeof (logging) === "boolean") {
                this.logging = logging;
            }
        },

        _parseResponse: function (response) {
            var that = this;

            if (!response) {
                return response;
            } else if (typeof response === "string") {
                return that.json.parse(response);
            } else {
                return response;
            }
        },

        _originalJson: window.JSON,

        json: window.JSON,

        isCrossDomain: function (url, against) {
            /// <summary>Checks if url is cross domain</summary>
            /// <param name="url" type="String">The base URL</param>
            /// <param name="against" type="Object">
            ///     An optional argument to compare the URL against, if not specified it will be set to window.location.
            ///     If specified it must contain a protocol and a host property.
            /// </param>
            var link;

            url = $.trim(url);

            against = against || window.location;

            if (url.indexOf("http") !== 0) {
                return false;
            }

            // Create an anchor tag.
            link = window.document.createElement("a");
            link.href = url;

            // When checking for cross domain we have to special case port 80 because the window.location will remove the
            return link.protocol + addDefaultPort(link.protocol, link.host) !== against.protocol + addDefaultPort(against.protocol, against.host);
        },

        ajaxDataType: "text",

        contentType: "application/json; charset=UTF-8",

        logging: false,

        state: signalR.connectionState.disconnected,

        clientProtocol: "2.0",

        // We want to support older servers since the 2.0 change is to support redirection results, which isn't
        // really breaking in the protocol. So if a user updates their client to 2.0 protocol version there's
        // no reason they can't still connect to a 1.5 server.
        supportedProtocols: ["1.5", "2.0"],

        reconnectDelay: 2000,

        transportConnectTimeout: 0,

        disconnectTimeout: 30000, // This should be set by the server in response to the negotiate request (30s default)

        reconnectWindow: 30000, // This should be set by the server in response to the negotiate request

        keepAliveWarnAt: 2 / 3, // Warn user of slow connection if we breach the X% mark of the keep alive timeout

        start: function (options, callback) {
            /// <summary>Starts the connection</summary>
            /// <param name="options" type="Object">Options map</param>
            /// <param name="callback" type="Function">A callback function to execute when the connection has started</param>
            var connection = this,
                config = {
                    pingInterval: 300000,
                    waitForPageLoad: true,
                    transport: "auto",
                    jsonp: false
                },
                initialize,
                deferred = connection._deferral || $.Deferred(), // Check to see if there is a pre-existing deferral that's being built on, if so we want to keep using it
                parser = window.document.createElement("a"),
                setConnectionUrl = function (connection, url) {

                    // NOTE: commented out next three lines - we need to check for cross domain and set withCredentials
                    //if (connection.url === url && connection.baseUrl) {
                    //    // when the url related properties are already set
                    //    return;
                    //}

                    connection.url = url;

                    // Resolve the full url
                    parser.href = connection.url;
                    if (!parser.protocol || parser.protocol === ":") {
                        connection.protocol = window.document.location.protocol;
                        connection.host = parser.host || window.document.location.host;
                    } else {
                        connection.protocol = parser.protocol;
                        connection.host = parser.host;
                    }

                    connection.baseUrl = connection.protocol + "//" + connection.host;

                    // Set the websocket protocol
                    connection.wsProtocol = connection.protocol === "https:" ? "wss://" : "ws://";

                    // If the url is protocol relative, prepend the current windows protocol to the url.
                    if (connection.url.indexOf("//") === 0) {
                        connection.url = window.location.protocol + connection.url;
                        connection.log("Protocol relative URL detected, normalizing it to '" + connection.url + "'.");
                    }

                    if (connection.isCrossDomain(connection.url)) {
                        connection.log("Auto detected cross domain url.");

                        if (config.transport === "auto") {
                            // Cross-domain does not support foreverFrame
                            config.transport = ["webSockets", "serverSentEvents", "longPolling"];
                        }

                        if (typeof connection.withCredentials === "undefined") {
                            connection.withCredentials = true;
                        }

                        // Determine if jsonp is the only choice for negotiation, ajaxSend and ajaxAbort.
                        // i.e. if the browser doesn't supports CORS
                        // If it is, ignore any preference to the contrary, and switch to jsonp.
                        if (!$.support.cors) {
                            connection.ajaxDataType = "jsonp";
                            connection.log("Using jsonp because this browser doesn't support CORS.");
                        }

                        connection.contentType = signalR._.defaultContentType;
                    }
                };

            connection.lastError = null;

            // Persist the deferral so that if start is called multiple times the same deferral is used.
            connection._deferral = deferred;

            if (!connection.json) {
                // no JSON!
                throw new Error("SignalR: No JSON parser found. Please ensure json2.js is referenced before the SignalR.js file if you need to support clients without native JSON parsing support, e.g. IE<8.");
            }

            if ($.type(options) === "function") {
                // Support calling with single callback parameter
                callback = options;
            } else if ($.type(options) === "object") {
                $.extend(config, options);
                if ($.type(config.callback) === "function") {
                    callback = config.callback;
                }
            }

            config.transport = validateTransport(config.transport, connection);

            // If the transport is invalid throw an error and abort start
            if (!config.transport) {
                throw new Error("SignalR: Invalid transport(s) specified, aborting start.");
            }

            connection._.config = config;

            // Check to see if start is being called prior to page load
            // If waitForPageLoad is true we then want to re-direct function call to the window load event
            if (!_pageLoaded && config.waitForPageLoad === true) {
                connection._.deferredStartHandler = function () {
                    connection.start(options, callback);
                };
                _pageWindow.bind("load", connection._.deferredStartHandler);

                return deferred.promise();
            }

            // If we're already connecting just return the same deferral as the original connection start
            if (connection.state === signalR.connectionState.connecting) {
                return deferred.promise();
            } else if (changeState(connection,
                signalR.connectionState.disconnected,
                signalR.connectionState.connecting) === false) {
                // We're not connecting so try and transition into connecting.
                // If we fail to transition then we're either in connected or reconnecting.

                deferred.resolve(connection);
                return deferred.promise();
            }

            configureStopReconnectingTimeout(connection);

            // If jsonp with no/auto transport is specified, then set the transport to long polling
            // since that is the only transport for which jsonp really makes sense.
            // Some developers might actually choose to specify jsonp for same origin requests
            // as demonstrated by Issue #623.
            if (config.transport === "auto" && config.jsonp === true) {
                config.transport = "longPolling";
            }

            connection.withCredentials = config.withCredentials;

            setConnectionUrl(connection, connection.url);

            // Save the original url so that we can reset it when we stop and restart the connection
            connection._originalUrl = connection.url;

            connection.ajaxDataType = config.jsonp ? "jsonp" : "text";

            $(connection).bind(events.onStart, function (e, data) {
                if ($.type(callback) === "function") {
                    callback.call(connection);
                }
                deferred.resolve(connection);
            });

            connection._.initHandler = signalR.transports._logic.initHandler(connection);

            initialize = function (transports, index) {
                var noTransportError = signalR._.error(resources.noTransportOnInit);

                index = index || 0;
                if (index >= transports.length) {
                    if (index === 0) {
                        connection.log("No transports supported by the server were selected.");
                    } else if (index === 1) {
                        connection.log("No fallback transports were selected.");
                    } else {
                        connection.log("Fallback transports exhausted.");
                    }

                    // No transport initialized successfully
                    $(connection).triggerHandler(events.onError, [noTransportError]);
                    deferred.reject(noTransportError);
                    // Stop the connection if it has connected and move it into the disconnected state
                    connection.stop();
                    return;
                }

                // The connection was aborted
                if (connection.state === signalR.connectionState.disconnected) {
                    return;
                }

                var transportName = transports[index],
                    transport = signalR.transports[transportName],
                    onFallback = function () {
                        initialize(transports, index + 1);
                    };

                connection.transport = transport;

                try {
                    connection._.initHandler.start(transport, function () { // success
                        // Firefox 11+ doesn't allow sync XHR withCredentials: https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest#withCredentials
                        var isFirefox11OrGreater = signalR._.firefoxMajorVersion(window.navigator.userAgent) >= 11,
                            asyncAbort = true;

                        connection.log("The start request succeeded. Transitioning to the connected state.");

                        if (supportsKeepAlive(connection)) {
                            signalR.transports._logic.monitorKeepAlive(connection);
                        }

                        signalR.transports._logic.startHeartbeat(connection);

                        // Used to ensure low activity clients maintain their authentication.
                        // Must be configured once a transport has been decided to perform valid ping requests.
                        signalR._.configurePingInterval(connection);

                        if (!changeState(connection,
                            signalR.connectionState.connecting,
                            signalR.connectionState.connected)) {
                            connection.log("WARNING! The connection was not in the connecting state.");
                        }

                        // Drain any incoming buffered messages (messages that came in prior to connect)
                        connection._.connectingMessageBuffer.drain();

                        $(connection).triggerHandler(events.onStart);

                        // wire the stop handler for when the user leaves the page
                        _pageWindow.bind("unload", function () {
                            connection.log("Window unloading, stopping the connection.");

                            connection.stop(asyncAbort);
                        });

                        if (isFirefox11OrGreater) {
                            // Firefox does not fire cross-domain XHRs in the normal unload handler on tab close.
                            // #2400
                            _pageWindow.bind("beforeunload", function () {
                                // If connection.stop() runs runs in beforeunload and fails, it will also fail
                                // in unload unless connection.stop() runs after a timeout.
                                window.setTimeout(function () {
                                    connection.stop(asyncAbort);
                                }, 0);
                            });
                        }
                    }, onFallback);
                }
                catch (error) {
                    connection.log(transport.name + " transport threw '" + error.message + "' when attempting to start.");
                    onFallback();
                }
            };

            var url = connection.url + "/negotiate",
                onFailed = function (error, connection) {
                    var err = signalR._.error(resources.errorOnNegotiate, error, connection._.negotiateRequest);

                    $(connection).triggerHandler(events.onError, err);
                    deferred.reject(err);
                    // Stop the connection if negotiate failed
                    connection.stop();
                };

            $(connection).triggerHandler(events.onStarting);

            url = signalR.transports._logic.prepareQueryString(connection, url);

            connection.log("Negotiating with '" + url + "'.");

            // Save the ajax negotiate request object so we can abort it if stop is called while the request is in flight.
            connection._.negotiateRequest = function () {
                var res,
                    redirects = 0,
                    MAX_REDIRECTS = 100,
                    keepAliveData,
                    protocolError,
                    transports = [],
                    supportedTransports = [],
                    negotiate = function (connection, onSuccess) {
                        var url = signalR.transports._logic.prepareQueryString(connection, connection.url + "/negotiate");
                        connection.log("Negotiating with '" + url + "'.");
                        var options = {
                            url: url,
                            error: function (error, statusText) {
                                // We don't want to cause any errors if we're aborting our own negotiate request.
                                if (statusText !== _negotiateAbortText) {
                                    onFailed(error, connection);
                                } else {
                                    // This rejection will noop if the deferred has already been resolved or rejected.
                                    deferred.reject(signalR._.error(resources.stoppedWhileNegotiating, null /* error */, connection._.negotiateRequest));
                                }
                            },
                            success: onSuccess
                        };

                        if (connection.accessToken) {
                            options.headers = { "Authorization": "Bearer " + connection.accessToken };
                        }

                        return signalR.transports._logic.ajax(connection, options);
                    },
                    callback = function (result) {
                        try {
                            res = connection._parseResponse(result);
                        } catch (error) {
                            onFailed(signalR._.error(resources.errorParsingNegotiateResponse, error), connection);
                            return;
                        }

                        // Check if the server is an ASP.NET Core app
                        if (res.availableTransports) {
                            protocolError = signalR._.error(resources.aspnetCoreSignalrServer);
                            $(connection).triggerHandler(events.onError, [protocolError]);
                            deferred.reject(protocolError);
                            return;
                        }

                        if (!res.ProtocolVersion || (connection.supportedProtocols.indexOf(res.ProtocolVersion) === -1)) {
                            protocolError = signalR._.error(signalR._.format(resources.protocolIncompatible, connection.clientProtocol, res.ProtocolVersion));
                            $(connection).triggerHandler(events.onError, [protocolError]);
                            deferred.reject(protocolError);

                            return;
                        }

                        // Check for a redirect response (which must have a ProtocolVersion of 2.0)
                        if (res.ProtocolVersion === "2.0") {
                            if (res.Error) {
                                protocolError = signalR._.error(signalR._.format(resources.errorFromServer, res.Error));
                                $(connection).triggerHandler(events.onError, [protocolError]);
                                deferred.reject(protocolError);
                                return;
                            }
                            else if (res.RedirectUrl) {
                                if (redirects === MAX_REDIRECTS) {
                                    onFailed(signalR._.error(resources.errorRedirectionExceedsLimit), connection);
                                    return;
                                }

                                if (config.transport === "auto") {
                                    // Redirected connections do not support foreverFrame
                                    config.transport = ["webSockets", "serverSentEvents", "longPolling"];
                                }

                                connection.log("Received redirect to: " + res.RedirectUrl);
                                connection.accessToken = res.AccessToken;

                                setConnectionUrl(connection, res.RedirectUrl);

                                if (connection.ajaxDataType === "jsonp" && connection.accessToken) {
                                    onFailed(signalR._.error(resources.jsonpNotSupportedWithAccessToken), connection);
                                    return;
                                }

                                redirects++;
                                negotiate(connection, callback);
                                return;
                            }
                        }

                        keepAliveData = connection._.keepAliveData;
                        connection.appRelativeUrl = res.Url;
                        connection.id = res.ConnectionId;
                        connection.token = res.ConnectionToken;
                        connection.webSocketServerUrl = res.WebSocketServerUrl;

                        // The long poll timeout is the ConnectionTimeout plus 10 seconds
                        connection._.pollTimeout = res.ConnectionTimeout * 1000 + 10000; // in ms

                        // Once the server has labeled the PersistentConnection as Disconnected, we should stop attempting to reconnect
                        // after res.DisconnectTimeout seconds.
                        connection.disconnectTimeout = res.DisconnectTimeout * 1000; // in ms

                        // Add the TransportConnectTimeout from the response to the transportConnectTimeout from the client to calculate the total timeout
                        connection._.totalTransportConnectTimeout = connection.transportConnectTimeout + res.TransportConnectTimeout * 1000;

                        // If we have a keep alive
                        if (res.KeepAliveTimeout) {
                            // Register the keep alive data as activated
                            keepAliveData.activated = true;

                            // Timeout to designate when to force the connection into reconnecting converted to milliseconds
                            keepAliveData.timeout = res.KeepAliveTimeout * 1000;

                            // Timeout to designate when to warn the developer that the connection may be dead or is not responding.
                            keepAliveData.timeoutWarning = keepAliveData.timeout * connection.keepAliveWarnAt;

                            // Instantiate the frequency in which we check the keep alive.  It must be short in order to not miss/pick up any changes
                            connection._.beatInterval = (keepAliveData.timeout - keepAliveData.timeoutWarning) / 3;
                        } else {
                            keepAliveData.activated = false;
                        }

                        connection.reconnectWindow = connection.disconnectTimeout + (keepAliveData.timeout || 0);

                        $.each(signalR.transports, function (key) {
                            if ((key.indexOf("_") === 0) || (key === "webSockets" && !res.TryWebSockets)) {
                                return true;
                            }
                            supportedTransports.push(key);
                        });

                        if ($.isArray(config.transport)) {
                            $.each(config.transport, function (_, transport) {
                                if ($.inArray(transport, supportedTransports) >= 0) {
                                    transports.push(transport);
                                }
                            });
                        } else if (config.transport === "auto") {
                            transports = supportedTransports;
                        } else if ($.inArray(config.transport, supportedTransports) >= 0) {
                            transports.push(config.transport);
                        }

                        initialize(transports);
                    };

                return negotiate(connection, callback);
            }();

            return deferred.promise();
        },

        starting: function (callback) {
            /// <summary>Adds a callback that will be invoked before anything is sent over the connection</summary>
            /// <param name="callback" type="Function">A callback function to execute before the connection is fully instantiated.</param>
            /// <returns type="signalR" />
            var connection = this;
            $(connection).bind(events.onStarting, function (e, data) {
                callback.call(connection);
            });
            return connection;
        },

        send: function (data) {
            /// <summary>Sends data over the connection</summary>
            /// <param name="data" type="String">The data to send over the connection</param>
            /// <returns type="signalR" />
            var connection = this;

            if (connection.state === signalR.connectionState.disconnected) {
                // Connection hasn't been started yet
                throw new Error("SignalR: Connection must be started before data can be sent. Call .start() before .send()");
            }

            if (connection.state === signalR.connectionState.connecting) {
                // Connection hasn't been started yet
                throw new Error("SignalR: Connection has not been fully initialized. Use .start().done() or .start().fail() to run logic after the connection has started.");
            }

            connection.transport.send(connection, data);
            // REVIEW: Should we return deferred here?
            return connection;
        },

        received: function (callback) {
            /// <summary>Adds a callback that will be invoked after anything is received over the connection</summary>
            /// <param name="callback" type="Function">A callback function to execute when any data is received on the connection</param>
            /// <returns type="signalR" />
            var connection = this;
            $(connection).bind(events.onReceived, function (e, data) {
                callback.call(connection, data);
            });
            return connection;
        },

        stateChanged: function (callback) {
            /// <summary>Adds a callback that will be invoked when the connection state changes</summary>
            /// <param name="callback" type="Function">A callback function to execute when the connection state changes</param>
            /// <returns type="signalR" />
            var connection = this;
            $(connection).bind(events.onStateChanged, function (e, data) {
                callback.call(connection, data);
            });
            return connection;
        },

        error: function (callback) {
            /// <summary>Adds a callback that will be invoked after an error occurs with the connection</summary>
            /// <param name="callback" type="Function">A callback function to execute when an error occurs on the connection</param>
            /// <returns type="signalR" />
            var connection = this;
            $(connection).bind(events.onError, function (e, errorData, sendData) {
                connection.lastError = errorData;
                // In practice 'errorData' is the SignalR built error object.
                // In practice 'sendData' is undefined for all error events except those triggered by
                // 'ajaxSend' and 'webSockets.send'.'sendData' is the original send payload.
                callback.call(connection, errorData, sendData);
            });
            return connection;
        },

        disconnected: function (callback) {
            /// <summary>Adds a callback that will be invoked when the client disconnects</summary>
            /// <param name="callback" type="Function">A callback function to execute when the connection is broken</param>
            /// <returns type="signalR" />
            var connection = this;
            $(connection).bind(events.onDisconnect, function (e, data) {
                callback.call(connection);
            });
            return connection;
        },

        connectionSlow: function (callback) {
            /// <summary>Adds a callback that will be invoked when the client detects a slow connection</summary>
            /// <param name="callback" type="Function">A callback function to execute when the connection is slow</param>
            /// <returns type="signalR" />
            var connection = this;
            $(connection).bind(events.onConnectionSlow, function (e, data) {
                callback.call(connection);
            });

            return connection;
        },

        reconnecting: function (callback) {
            /// <summary>Adds a callback that will be invoked when the underlying transport begins reconnecting</summary>
            /// <param name="callback" type="Function">A callback function to execute when the connection enters a reconnecting state</param>
            /// <returns type="signalR" />
            var connection = this;
            $(connection).bind(events.onReconnecting, function (e, data) {
                callback.call(connection);
            });
            return connection;
        },

        reconnected: function (callback) {
            /// <summary>Adds a callback that will be invoked when the underlying transport reconnects</summary>
            /// <param name="callback" type="Function">A callback function to execute when the connection is restored</param>
            /// <returns type="signalR" />
            var connection = this;
            $(connection).bind(events.onReconnect, function (e, data) {
                callback.call(connection);
            });
            return connection;
        },

        stop: function (async, notifyServer) {
            /// <summary>Stops listening</summary>
            /// <param name="async" type="Boolean">Whether or not to asynchronously abort the connection</param>
            /// <param name="notifyServer" type="Boolean">Whether we want to notify the server that we are aborting the connection</param>
            /// <returns type="signalR" />
            var connection = this,
                // Save deferral because this is always cleaned up
                deferral = connection._deferral;

            // Verify that we've bound a load event.
            if (connection._.deferredStartHandler) {
                // Unbind the event.
                _pageWindow.unbind("load", connection._.deferredStartHandler);
            }

            // Always clean up private non-timeout based state.
            delete connection._.config;
            delete connection._.deferredStartHandler;

            // This needs to be checked despite the connection state because a connection start can be deferred until page load.
            // If we've deferred the start due to a page load we need to unbind the "onLoad" -> start event.
            if (!_pageLoaded && (!connection._.config || connection._.config.waitForPageLoad === true)) {
                connection.log("Stopping connection prior to negotiate.");

                // If we have a deferral we should reject it
                if (deferral) {
                    deferral.reject(signalR._.error(resources.stoppedWhileLoading));
                }

                // Short-circuit because the start has not been fully started.
                return;
            }

            if (connection.state === signalR.connectionState.disconnected) {
                return;
            }

            connection.log("Stopping connection.");

            // Clear this no matter what
            window.clearTimeout(connection._.beatHandle);
            window.clearInterval(connection._.pingIntervalId);

            if (connection.transport) {
                connection.transport.stop(connection);

                if (notifyServer !== false) {
                    connection.transport.abort(connection, async);
                }

                if (supportsKeepAlive(connection)) {
                    signalR.transports._logic.stopMonitoringKeepAlive(connection);
                }

                connection.transport = null;
            }

            if (connection._.negotiateRequest) {
                // If the negotiation request has already completed this will noop.
                connection._.negotiateRequest.abort(_negotiateAbortText);
                delete connection._.negotiateRequest;
            }

            // Ensure that initHandler.stop() is called before connection._deferral is deleted
            if (connection._.initHandler) {
                connection._.initHandler.stop();
            }

            delete connection._deferral;
            delete connection.messageId;
            delete connection.groupsToken;
            delete connection.id;
            delete connection._.pingIntervalId;
            delete connection._.lastMessageAt;
            delete connection._.lastActiveAt;

            // Clear out our message buffer
            connection._.connectingMessageBuffer.clear();

            // Clean up this event
            $(connection).unbind(events.onStart);

            // Reset the URL and clear the access token
            delete connection.accessToken;
            connection.url = connection._originalUrl;

            // Trigger the disconnect event
            changeState(connection, connection.state, signalR.connectionState.disconnected);
            $(connection).triggerHandler(events.onDisconnect);

            return connection;
        },

        log: function (msg) {
            log(msg, this.logging);
        }
    };

    signalR.fn.init.prototype = signalR.fn;

    signalR.noConflict = function () {
        /// <summary>Reinstates the original value of $.connection and returns the signalR object for manual assignment</summary>
        /// <returns type="signalR" />
        if ($.connection === signalR) {
            $.connection = _connection;
        }
        return signalR;
    };

    if ($.connection) {
        _connection = $.connection;
    }

    $.connection = $.signalR = signalR;

}(jQuery, window));
/* jquery.signalR.transports.common.js */
// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.

/*global window:false */
/// <reference path="jquery.signalR.core.js" />

(function ($, window, undefined) {

    var signalR = $.signalR,
        events = $.signalR.events,
        changeState = $.signalR.changeState,
        startAbortText = "__Start Aborted__",
        transportLogic;

    signalR.transports = {};

    function beat(connection) {
        if (connection._.keepAliveData.monitoring) {
            checkIfAlive(connection);
        }

        // Ensure that we successfully marked active before continuing the heartbeat.
        if (transportLogic.markActive(connection)) {
            connection._.beatHandle = window.setTimeout(function () {
                beat(connection);
            }, connection._.beatInterval);
        }
    }

    function checkIfAlive(connection) {
        var keepAliveData = connection._.keepAliveData,
            timeElapsed;

        // Only check if we're connected
        if (connection.state === signalR.connectionState.connected) {
            timeElapsed = new Date().getTime() - connection._.lastMessageAt;

            // Check if the keep alive has completely timed out
            if (timeElapsed >= keepAliveData.timeout) {
                connection.log("Keep alive timed out.  Notifying transport that connection has been lost.");

                // Notify transport that the connection has been lost
                connection.transport.lostConnection(connection);
            } else if (timeElapsed >= keepAliveData.timeoutWarning) {
                // This is to assure that the user only gets a single warning
                if (!keepAliveData.userNotified) {
                    connection.log("Keep alive has been missed, connection may be dead/slow.");
                    $(connection).triggerHandler(events.onConnectionSlow);
                    keepAliveData.userNotified = true;
                }
            } else {
                keepAliveData.userNotified = false;
            }
        }
    }

    function getAjaxUrl(connection, path) {
        var url = connection.url + path;

        if (connection.transport) {
            url += "?transport=" + connection.transport.name;
        }

        return transportLogic.prepareQueryString(connection, url);
    }

    function InitHandler(connection) {
        this.connection = connection;

        this.startRequested = false;
        this.startCompleted = false;
        this.connectionStopped = false;
    }

    InitHandler.prototype = {
        start: function (transport, onSuccess, onFallback) {
            var that = this,
                connection = that.connection,
                failCalled = false;

            if (that.startRequested || that.connectionStopped) {
                connection.log("WARNING! " + transport.name + " transport cannot be started. Initialization ongoing or completed.");
                return;
            }

            connection.log(transport.name + " transport starting.");

            transport.start(connection, function () {
                if (!failCalled) {
                    that.initReceived(transport, onSuccess);
                }
            }, function (error) {
                // Don't allow the same transport to cause onFallback to be called twice
                if (!failCalled) {
                    failCalled = true;
                    that.transportFailed(transport, error, onFallback);
                }

                // Returns true if the transport should stop;
                // false if it should attempt to reconnect
                return !that.startCompleted || that.connectionStopped;
            });

            that.transportTimeoutHandle = window.setTimeout(function () {
                if (!failCalled) {
                    failCalled = true;
                    connection.log(transport.name + " transport timed out when trying to connect.");
                    that.transportFailed(transport, undefined, onFallback);
                }
            }, connection._.totalTransportConnectTimeout);
        },

        stop: function () {
            this.connectionStopped = true;
            window.clearTimeout(this.transportTimeoutHandle);
            signalR.transports._logic.tryAbortStartRequest(this.connection);
        },

        initReceived: function (transport, onSuccess) {
            var that = this,
                connection = that.connection;

            if (that.startRequested) {
                connection.log("WARNING! The client received multiple init messages.");
                return;
            }

            if (that.connectionStopped) {
                return;
            }

            that.startRequested = true;
            window.clearTimeout(that.transportTimeoutHandle);

            connection.log(transport.name + " transport connected. Initiating start request.");
            signalR.transports._logic.ajaxStart(connection, function () {
                that.startCompleted = true;
                onSuccess();
            });
        },

        transportFailed: function (transport, error, onFallback) {
            var connection = this.connection,
                deferred = connection._deferral,
                wrappedError;

            if (this.connectionStopped) {
                return;
            }

            window.clearTimeout(this.transportTimeoutHandle);

            if (!this.startRequested) {
                transport.stop(connection);

                connection.log(transport.name + " transport failed to connect. Attempting to fall back.");
                onFallback();
            } else if (!this.startCompleted) {
                // Do not attempt to fall back if a start request is ongoing during a transport failure.
                // Instead, trigger an error and stop the connection.
                wrappedError = signalR._.error(signalR.resources.errorDuringStartRequest, error);

                connection.log(transport.name + " transport failed during the start request. Stopping the connection.");
                $(connection).triggerHandler(events.onError, [wrappedError]);
                if (deferred) {
                    deferred.reject(wrappedError);
                }

                connection.stop();
            } else {
                // The start request has completed, but the connection has not stopped.
                // No need to do anything here. The transport should attempt its normal reconnect logic.
            }
        }
    };

    transportLogic = signalR.transports._logic = {
        ajax: function (connection, options) {
            return $.ajax(
                $.extend(/*deep copy*/ true, {}, $.signalR.ajaxDefaults, {
                    type: "GET",
                    data: {},
                    xhrFields: { withCredentials: connection.withCredentials },
                    contentType: connection.contentType,
                    dataType: connection.ajaxDataType
                }, options));
        },

        pingServer: function (connection) {
            /// <summary>Pings the server</summary>
            /// <param name="connection" type="signalr">Connection associated with the server ping</param>
            /// <returns type="signalR" />
            var url,
                xhr,
                deferral = $.Deferred();

            if (connection.transport) {
                url = connection.url + "/ping";

                url = transportLogic.addQs(url, connection.qs);

                xhr = transportLogic.ajax(connection, {
                    url: url,
                    headers: connection.accessToken ? { "Authorization": "Bearer " + connection.accessToken } : {},
                    success: function (result) {
                        var data;

                        try {
                            data = connection._parseResponse(result);
                        }
                        catch (error) {
                            deferral.reject(
                                signalR._.transportError(
                                    signalR.resources.pingServerFailedParse,
                                    connection.transport,
                                    error,
                                    xhr
                                )
                            );
                            connection.stop();
                            return;
                        }

                        if (data.Response === "pong") {
                            deferral.resolve();
                        }
                        else {
                            deferral.reject(
                                signalR._.transportError(
                                    signalR._.format(signalR.resources.pingServerFailedInvalidResponse, result),
                                    connection.transport,
                                    null /* error */,
                                    xhr
                                )
                            );
                        }
                    },
                    error: function (error) {
                        if (error.status === 401 || error.status === 403) {
                            deferral.reject(
                                signalR._.transportError(
                                    signalR._.format(signalR.resources.pingServerFailedStatusCode, error.status),
                                    connection.transport,
                                    error,
                                    xhr
                                )
                            );
                            connection.stop();
                        }
                        else {
                            deferral.reject(
                                signalR._.transportError(
                                    signalR.resources.pingServerFailed,
                                    connection.transport,
                                    error,
                                    xhr
                                )
                            );
                        }
                    }
                });
            }
            else {
                deferral.reject(
                    signalR._.transportError(
                        signalR.resources.noConnectionTransport,
                        connection.transport
                    )
                );
            }

            return deferral.promise();
        },

        prepareQueryString: function (connection, url) {
            var preparedUrl;

            // Use addQs to start since it handles the ?/& prefix for us
            preparedUrl = transportLogic.addQs(url, "clientProtocol=" + connection.clientProtocol);

            // Add the user-specified query string params if any
            preparedUrl = transportLogic.addQs(preparedUrl, connection.qs);

            if (connection.token) {
                preparedUrl += "&connectionToken=" + encodeURIComponent(connection.token);
            }

            if (connection.data) {
                preparedUrl += "&connectionData=" + encodeURIComponent(connection.data);
            }

            return preparedUrl;
        },

        addQs: function (url, qs) {
            var appender = url.indexOf("?") !== -1 ? "&" : "?",
                firstChar;

            if (!qs) {
                return url;
            }

            if (typeof (qs) === "object") {
                return url + appender + $.param(qs);
            }

            if (typeof (qs) === "string") {
                firstChar = qs.charAt(0);

                if (firstChar === "?" || firstChar === "&") {
                    appender = "";
                }

                return url + appender + qs;
            }

            throw new Error("Query string property must be either a string or object.");
        },

        // BUG #2953: The url needs to be same otherwise it will cause a memory leak
        getUrl: function (connection, transport, reconnecting, poll, ajaxPost) {
            /// <summary>Gets the url for making a GET based connect request</summary>
            var baseUrl = transport === "webSockets" ? "" : connection.baseUrl,
                url = baseUrl + connection.appRelativeUrl,
                qs = "transport=" + transport;

            if (!ajaxPost && connection.groupsToken) {
                qs += "&groupsToken=" + encodeURIComponent(connection.groupsToken);
            }

            if (!reconnecting) {
                url += "/connect";
            } else {
                if (poll) {
                    // longPolling transport specific
                    url += "/poll";
                } else {
                    url += "/reconnect";
                }

                if (!ajaxPost && connection.messageId) {
                    qs += "&messageId=" + encodeURIComponent(connection.messageId);
                }
            }
            url += "?" + qs;
            url = transportLogic.prepareQueryString(connection, url);

            // With sse or ws, access_token in request header is not supported
            if (connection.transport && connection.accessToken) {
                if (connection.transport.name === "serverSentEvents" || connection.transport.name === "webSockets") {
                    url += "&access_token=" + encodeURIComponent(connection.accessToken);
                }
            }

            if (!ajaxPost) {
                url += "&tid=" + Math.floor(Math.random() * 11);
            }

            return url;
        },

        maximizePersistentResponse: function (minPersistentResponse) {
            return {
                MessageId: minPersistentResponse.C,
                Messages: minPersistentResponse.M,
                Initialized: typeof (minPersistentResponse.S) !== "undefined" ? true : false,
                ShouldReconnect: typeof (minPersistentResponse.T) !== "undefined" ? true : false,
                LongPollDelay: minPersistentResponse.L,
                GroupsToken: minPersistentResponse.G,
                Error: minPersistentResponse.E
            };
        },

        updateGroups: function (connection, groupsToken) {
            if (groupsToken) {
                connection.groupsToken = groupsToken;
            }
        },

        stringifySend: function (connection, message) {
            if (typeof (message) === "string" || typeof (message) === "undefined" || message === null) {
                return message;
            }
            return connection.json.stringify(message);
        },

        ajaxSend: function (connection, data) {
            var payload = transportLogic.stringifySend(connection, data),
                url = getAjaxUrl(connection, "/send"),
                xhr,
                onFail = function (error, connection) {
                    $(connection).triggerHandler(events.onError, [signalR._.transportError(signalR.resources.sendFailed, connection.transport, error, xhr), data]);
                };


            xhr = transportLogic.ajax(connection, {
                url: url,
                type: connection.ajaxDataType === "jsonp" ? "GET" : "POST",
                contentType: signalR._.defaultContentType,
                headers: connection.accessToken ? { "Authorization": "Bearer " + connection.accessToken } : {},
                data: {
                    data: payload
                },
                success: function (result) {
                    var res;

                    if (result) {
                        try {
                            res = connection._parseResponse(result);
                        }
                        catch (error) {
                            onFail(error, connection);
                            connection.stop();
                            return;
                        }

                        transportLogic.triggerReceived(connection, res);
                    }
                },
                error: function (error, textStatus) {
                    if (textStatus === "abort" || textStatus === "parsererror") {
                        // The parsererror happens for sends that don't return any data, and hence
                        // don't write the jsonp callback to the response. This is harder to fix on the server
                        // so just hack around it on the client for now.
                        return;
                    }

                    onFail(error, connection);
                }
            });

            return xhr;
        },

        ajaxAbort: function (connection, async) {
            if (typeof (connection.transport) === "undefined") {
                return;
            }

            // Async by default unless explicitly overidden
            //async = typeof async === "undefined" ? true : async;
            var asyncLocal = typeof async === "undefined" ? true : async;

            var url = getAjaxUrl(connection, "/abort");

            transportLogic.ajax(connection, {
                url: url,
                async: asyncLocal,
                timeout: 1000,
                type: "POST",
                headers: connection.accessToken ? { "Authorization": "Bearer " + connection.accessToken } : {},
                dataType: "text" // We don't want to use JSONP here even when JSONP is enabled
            });

            connection.log("Fired ajax abort async = " + async + ".");
        },

        ajaxStart: function (connection, onSuccess) {
            var rejectDeferred = function (error) {
                var deferred = connection._deferral;
                if (deferred) {
                    deferred.reject(error);
                }
            },
                triggerStartError = function (error) {
                    connection.log("The start request failed. Stopping the connection.");
                    $(connection).triggerHandler(events.onError, [error]);
                    rejectDeferred(error);
                    connection.stop();
                };

            connection._.startRequest = transportLogic.ajax(connection, {
                url: getAjaxUrl(connection, "/start"),
                headers: connection.accessToken ? { "Authorization": "Bearer " + connection.accessToken } : {},
                success: function (result, statusText, xhr) {
                    var data;

                    try {
                        data = connection._parseResponse(result);
                    } catch (error) {
                        triggerStartError(signalR._.error(
                            signalR._.format(signalR.resources.errorParsingStartResponse, result),
                            error, xhr));
                        return;
                    }

                    if (data.Response === "started") {
                        onSuccess();
                    } else {
                        triggerStartError(signalR._.error(
                            signalR._.format(signalR.resources.invalidStartResponse, result),
                            null /* error */, xhr));
                    }
                },
                error: function (xhr, statusText, error) {
                    if (statusText !== startAbortText) {
                        triggerStartError(signalR._.error(
                            signalR.resources.errorDuringStartRequest,
                            error, xhr));
                    } else {
                        // Stop has been called, no need to trigger the error handler
                        // or stop the connection again with onStartError
                        connection.log("The start request aborted because connection.stop() was called.");
                        rejectDeferred(signalR._.error(
                            signalR.resources.stoppedDuringStartRequest,
                            null /* error */, xhr));
                    }
                }
            });
        },

        tryAbortStartRequest: function (connection) {
            if (connection._.startRequest) {
                // If the start request has already completed this will noop.
                connection._.startRequest.abort(startAbortText);
                delete connection._.startRequest;
            }
        },

        tryInitialize: function (connection, persistentResponse, onInitialized) {
            if (persistentResponse.Initialized && onInitialized) {
                onInitialized();
            } else if (persistentResponse.Initialized) {
                connection.log("WARNING! The client received an init message after reconnecting.");
            }

        },

        triggerReceived: function (connection, data) {
            if (!connection._.connectingMessageBuffer.tryBuffer(data)) {
                $(connection).triggerHandler(events.onReceived, [data]);
            }
        },

        processMessages: function (connection, minData, onInitialized) {
            var data;

            if (minData && (typeof minData.I !== "undefined")) {
                // This is a response to a message the client sent
                transportLogic.triggerReceived(connection, minData);
                return;
            }

            // Update the last message time stamp
            transportLogic.markLastMessage(connection);

            if (minData) {
                // This is a message send directly to the client
                data = transportLogic.maximizePersistentResponse(minData);

                if (data.Error) {
                    // This is a global error, stop the connection.
                    connection.log("Received an error message from the server: " + minData.E);
                    $(connection).triggerHandler(signalR.events.onError, [signalR._.error(minData.E, /* source */ "ServerError")]);
                    connection.stop(/* async */ false, /* notifyServer */ false);
                }

                transportLogic.updateGroups(connection, data.GroupsToken);

                if (data.MessageId) {
                    connection.messageId = data.MessageId;
                }

                if (data.Messages) {
                    $.each(data.Messages, function (index, message) {
                        transportLogic.triggerReceived(connection, message);
                    });

                    transportLogic.tryInitialize(connection, data, onInitialized);
                }
            }
        },

        monitorKeepAlive: function (connection) {
            var keepAliveData = connection._.keepAliveData;

            // If we haven't initiated the keep alive timeouts then we need to
            if (!keepAliveData.monitoring) {
                keepAliveData.monitoring = true;

                transportLogic.markLastMessage(connection);

                // Save the function so we can unbind it on stop
                connection._.keepAliveData.reconnectKeepAliveUpdate = function () {
                    // Mark a new message so that keep alive doesn't time out connections
                    transportLogic.markLastMessage(connection);
                };

                // Update Keep alive on reconnect
                $(connection).bind(events.onReconnect, connection._.keepAliveData.reconnectKeepAliveUpdate);

                connection.log("Now monitoring keep alive with a warning timeout of " + keepAliveData.timeoutWarning + ", keep alive timeout of " + keepAliveData.timeout + " and disconnecting timeout of " + connection.disconnectTimeout);
            } else {
                connection.log("Tried to monitor keep alive but it's already being monitored.");
            }
        },

        stopMonitoringKeepAlive: function (connection) {
            var keepAliveData = connection._.keepAliveData;

            // Only attempt to stop the keep alive monitoring if its being monitored
            if (keepAliveData.monitoring) {
                // Stop monitoring
                keepAliveData.monitoring = false;

                // Remove the updateKeepAlive function from the reconnect event
                $(connection).unbind(events.onReconnect, connection._.keepAliveData.reconnectKeepAliveUpdate);

                // Clear all the keep alive data
                connection._.keepAliveData = {};
                connection.log("Stopping the monitoring of the keep alive.");
            }
        },

        startHeartbeat: function (connection) {
            connection._.lastActiveAt = new Date().getTime();
            beat(connection);
        },

        markLastMessage: function (connection) {
            connection._.lastMessageAt = new Date().getTime();
        },

        markActive: function (connection) {
            if (transportLogic.verifyLastActive(connection)) {
                connection._.lastActiveAt = new Date().getTime();
                return true;
            }

            return false;
        },

        isConnectedOrReconnecting: function (connection) {
            return connection.state === signalR.connectionState.connected ||
                connection.state === signalR.connectionState.reconnecting;
        },

        ensureReconnectingState: function (connection) {
            if (changeState(connection,
                signalR.connectionState.connected,
                signalR.connectionState.reconnecting) === true) {
                $(connection).triggerHandler(events.onReconnecting);
            }
            return connection.state === signalR.connectionState.reconnecting;
        },

        clearReconnectTimeout: function (connection) {
            if (connection && connection._.reconnectTimeout) {
                window.clearTimeout(connection._.reconnectTimeout);
                delete connection._.reconnectTimeout;
            }
        },

        verifyLastActive: function (connection) {
            if (new Date().getTime() - connection._.lastActiveAt >= connection.reconnectWindow) {
                var message = signalR._.format(signalR.resources.reconnectWindowTimeout, new Date(connection._.lastActiveAt), connection.reconnectWindow);
                connection.log(message);
                $(connection).triggerHandler(events.onError, [signalR._.error(message, /* source */ "TimeoutException")]);
                connection.stop(/* async */ false, /* notifyServer */ false);
                return false;
            }

            return true;
        },

        reconnect: function (connection, transportName) {
            var transport = signalR.transports[transportName];

            // We should only set a reconnectTimeout if we are currently connected
            // and a reconnectTimeout isn't already set.
            if (transportLogic.isConnectedOrReconnecting(connection) && !connection._.reconnectTimeout) {
                // Need to verify before the setTimeout occurs because an application sleep could occur during the setTimeout duration.
                if (!transportLogic.verifyLastActive(connection)) {
                    return;
                }

                connection._.reconnectTimeout = window.setTimeout(function () {
                    if (!transportLogic.verifyLastActive(connection)) {
                        return;
                    }

                    transport.stop(connection);

                    if (transportLogic.ensureReconnectingState(connection)) {
                        connection.log(transportName + " reconnecting.");
                        transport.start(connection);
                    }
                }, connection.reconnectDelay);
            }
        },

        handleParseFailure: function (connection, result, error, onFailed, context) {
            var wrappedError = signalR._.transportError(
                signalR._.format(signalR.resources.parseFailed, result),
                connection.transport,
                error,
                context);

            // If we're in the initialization phase trigger onFailed, otherwise stop the connection.
            if (onFailed && onFailed(wrappedError)) {
                connection.log("Failed to parse server response while attempting to connect.");
            } else {
                $(connection).triggerHandler(events.onError, [wrappedError]);
                connection.stop();
            }
        },

        initHandler: function (connection) {
            return new InitHandler(connection);
        },

        foreverFrame: {
            count: 0,
            connections: {}
        }
    };

}(jQuery, window));
/* jquery.signalR.transports.webSockets.js */
// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.


/*global window:false */
/// <reference path="jquery.signalR.transports.common.js" />

(function ($, window, undefined) {

    var signalR = $.signalR,
        events = $.signalR.events,
        changeState = $.signalR.changeState,
        transportLogic = signalR.transports._logic;

    signalR.transports.webSockets = {
        name: "webSockets",

        supportsKeepAlive: function () {
            return true;
        },

        send: function (connection, data) {
            var payload = transportLogic.stringifySend(connection, data);

            try {
                connection.socket.send(payload);
            } catch (ex) {
                $(connection).triggerHandler(events.onError,
                    [signalR._.transportError(
                        signalR.resources.webSocketsInvalidState,
                        connection.transport,
                        ex,
                        connection.socket
                    ),
                        data]);
            }
        },

        start: function (connection, onSuccess, onFailed) {
            var url,
                opened = false,
                that = this,
                reconnecting = !onSuccess,
                $connection = $(connection);

            if (!window.WebSocket) {
                onFailed();
                return;
            }

            if (!connection.socket) {
                if (connection.webSocketServerUrl) {
                    url = connection.webSocketServerUrl;
                } else {
                    url = connection.wsProtocol + connection.host;
                }

                url += transportLogic.getUrl(connection, this.name, reconnecting);

                connection.log("Connecting to websocket endpoint '" + url + "'.");
                connection.socket = new window.WebSocket(url);

                connection.socket.onopen = function () {
                    opened = true;
                    connection.log("Websocket opened.");

                    transportLogic.clearReconnectTimeout(connection);

                    if (changeState(connection,
                        signalR.connectionState.reconnecting,
                        signalR.connectionState.connected) === true) {
                        $connection.triggerHandler(events.onReconnect);
                    }
                };

                connection.socket.onclose = function (event) {
                    var error;

                    // Only handle a socket close if the close is from the current socket.
                    // Sometimes on disconnect the server will push down an onclose event
                    // to an expired socket.

                    if (this === connection.socket) {
                        if (opened && typeof event.wasClean !== "undefined" && event.wasClean === false) {
                            // Ideally this would use the websocket.onerror handler (rather than checking wasClean in onclose) but
                            // I found in some circumstances Chrome won't call onerror. This implementation seems to work on all browsers.
                            error = signalR._.transportError(
                                signalR.resources.webSocketClosed,
                                connection.transport,
                                event);

                            connection.log("Unclean disconnect from websocket: " + (event.reason || "[no reason given]."));
                        } else {
                            connection.log("Websocket closed.");
                        }

                        if (!onFailed || !onFailed(error)) {
                            if (error) {
                                $(connection).triggerHandler(events.onError, [error]);
                            }

                            that.reconnect(connection);
                        }
                    }
                };

                connection.socket.onmessage = function (event) {
                    var data;

                    try {
                        data = connection._parseResponse(event.data);
                    }
                    catch (error) {
                        transportLogic.handleParseFailure(connection, event.data, error, onFailed, event);
                        return;
                    }

                    if (data) {
                        transportLogic.processMessages(connection, data, onSuccess);
                    }
                };
            }
        },

        reconnect: function (connection) {
            transportLogic.reconnect(connection, this.name);
        },

        lostConnection: function (connection) {
            this.reconnect(connection);
        },

        stop: function (connection) {
            // Don't trigger a reconnect after stopping
            transportLogic.clearReconnectTimeout(connection);

            if (connection.socket) {
                connection.log("Closing the Websocket.");
                connection.socket.close();
                connection.socket = null;
            }
        },

        abort: function (connection, async) {
            transportLogic.ajaxAbort(connection, async);
        }
    };

}(jQuery, window));
/* jquery.signalR.transports.serverSentEvents.js */
// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.


/*global window:false */
/// <reference path="jquery.signalR.transports.common.js" />

(function ($, window, undefined) {

    var signalR = $.signalR,
        events = $.signalR.events,
        changeState = $.signalR.changeState,
        transportLogic = signalR.transports._logic,
        clearReconnectAttemptTimeout = function (connection) {
            window.clearTimeout(connection._.reconnectAttemptTimeoutHandle);
            delete connection._.reconnectAttemptTimeoutHandle;
        };

    signalR.transports.serverSentEvents = {
        name: "serverSentEvents",

        supportsKeepAlive: function () {
            return true;
        },

        timeOut: 3000,

        start: function (connection, onSuccess, onFailed) {
            var that = this,
                opened = false,
                $connection = $(connection),
                reconnecting = !onSuccess,
                url;

            if (connection.eventSource) {
                connection.log("The connection already has an event source. Stopping it.");
                connection.stop();
            }

            if (!window.EventSource) {
                if (onFailed) {
                    connection.log("This browser doesn't support SSE.");
                    onFailed();
                }
                return;
            }

            url = transportLogic.getUrl(connection, this.name, reconnecting);

            try {
                connection.log("Attempting to connect to SSE endpoint '" + url + "'.");
                connection.eventSource = new window.EventSource(url, { withCredentials: connection.withCredentials });
            }
            catch (e) {
                connection.log("EventSource failed trying to connect with error " + e.Message + ".");
                if (onFailed) {
                    // The connection failed, call the failed callback
                    onFailed();
                } else {
                    $connection.triggerHandler(events.onError, [signalR._.transportError(signalR.resources.eventSourceFailedToConnect, connection.transport, e)]);
                    if (reconnecting) {
                        // If we were reconnecting, rather than doing initial connect, then try reconnect again
                        that.reconnect(connection);
                    }
                }
                return;
            }

            if (reconnecting) {
                connection._.reconnectAttemptTimeoutHandle = window.setTimeout(function () {
                    if (opened === false) {
                        // If we're reconnecting and the event source is attempting to connect,
                        // don't keep retrying. This causes duplicate connections to spawn.
                        if (connection.eventSource.readyState !== window.EventSource.OPEN) {
                            // If we were reconnecting, rather than doing initial connect, then try reconnect again
                            that.reconnect(connection);
                        }
                    }
                },
                    that.timeOut);
            }

            connection.eventSource.addEventListener("open", function (e) {
                connection.log("EventSource connected.");

                clearReconnectAttemptTimeout(connection);
                transportLogic.clearReconnectTimeout(connection);

                if (opened === false) {
                    opened = true;

                    if (changeState(connection,
                        signalR.connectionState.reconnecting,
                        signalR.connectionState.connected) === true) {
                        $connection.triggerHandler(events.onReconnect);
                    }
                }
            }, false);

            connection.eventSource.addEventListener("message", function (e) {
                var res;

                // process messages
                if (e.data === "initialized") {
                    return;
                }

                try {
                    res = connection._parseResponse(e.data);
                }
                catch (error) {
                    transportLogic.handleParseFailure(connection, e.data, error, onFailed, e);
                    return;
                }

                transportLogic.processMessages(connection, res, onSuccess);
            }, false);

            connection.eventSource.addEventListener("error", function (e) {
                var error = signalR._.transportError(
                    signalR.resources.eventSourceError,
                    connection.transport,
                    e);

                // Only handle an error if the error is from the current Event Source.
                // Sometimes on disconnect the server will push down an error event
                // to an expired Event Source.
                if (this !== connection.eventSource) {
                    return;
                }

                if (onFailed && onFailed(error)) {
                    return;
                }

                connection.log("EventSource readyState: " + connection.eventSource.readyState + ".");

                if (e.eventPhase === window.EventSource.CLOSED) {
                    // We don't use the EventSource's native reconnect function as it
                    // doesn't allow us to change the URL when reconnecting. We need
                    // to change the URL to not include the /connect suffix, and pass
                    // the last message id we received.
                    connection.log("EventSource reconnecting due to the server connection ending.");
                    that.reconnect(connection);
                } else {
                    // connection error
                    connection.log("EventSource error.");
                    $connection.triggerHandler(events.onError, [error]);
                }
            }, false);
        },

        reconnect: function (connection) {
            transportLogic.reconnect(connection, this.name);
        },

        lostConnection: function (connection) {
            this.reconnect(connection);
        },

        send: function (connection, data) {
            transportLogic.ajaxSend(connection, data);
        },

        stop: function (connection) {
            // Don't trigger a reconnect after stopping
            clearReconnectAttemptTimeout(connection);
            transportLogic.clearReconnectTimeout(connection);

            if (connection && connection.eventSource) {
                connection.log("EventSource calling close().");
                connection.eventSource.close();
                connection.eventSource = null;
                delete connection.eventSource;
            }
        },

        abort: function (connection, async) {
            transportLogic.ajaxAbort(connection, async);
        }
    };

}(jQuery, window));
/* jquery.signalR.transports.foreverFrame.js */
// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.


/*global window:false */
/// <reference path="jquery.signalR.transports.common.js" />

(function ($, window, undefined) {

    var signalR = $.signalR,
        events = $.signalR.events,
        changeState = $.signalR.changeState,
        transportLogic = signalR.transports._logic,
        createFrame = function () {
            var frame = window.document.createElement("iframe");
            frame.setAttribute("style", "position:absolute;top:0;left:0;width:0;height:0;visibility:hidden;");
            return frame;
        },
        // Used to prevent infinite loading icon spins in older versions of ie
        // We build this object inside a closure so we don't pollute the rest of
        // the foreverFrame transport with unnecessary functions/utilities.
        loadPreventer = (function () {
            var loadingFixIntervalId = null,
                loadingFixInterval = 1000,
                attachedTo = 0;

            return {
                prevent: function () {
                    // Prevent additional iframe removal procedures from newer browsers
                    if (signalR._.ieVersion <= 8) {
                        // We only ever want to set the interval one time, so on the first attachedTo
                        if (attachedTo === 0) {
                            // Create and destroy iframe every 3 seconds to prevent loading icon, super hacky
                            loadingFixIntervalId = window.setInterval(function () {
                                var tempFrame = createFrame();

                                window.document.body.appendChild(tempFrame);
                                window.document.body.removeChild(tempFrame);

                                tempFrame = null;
                            }, loadingFixInterval);
                        }

                        attachedTo++;
                    }
                },
                cancel: function () {
                    // Only clear the interval if there's only one more object that the loadPreventer is attachedTo
                    if (attachedTo === 1) {
                        window.clearInterval(loadingFixIntervalId);
                    }

                    if (attachedTo > 0) {
                        attachedTo--;
                    }
                }
            };
        })();

    signalR.transports.foreverFrame = {
        name: "foreverFrame",

        supportsKeepAlive: function () {
            return true;
        },

        // Added as a value here so we can create tests to verify functionality
        iframeClearThreshold: 50,

        start: function (connection, onSuccess, onFailed) {
            if (connection.accessToken) {
                if (onFailed) {
                    connection.log("Forever Frame does not support connections that require a Bearer token to connect, such as the Azure SignalR Service.");
                    onFailed();
                }
                return;
            }

            var that = this,
                frameId = (transportLogic.foreverFrame.count += 1),
                url,
                frame = createFrame(),
                frameLoadHandler = function () {
                    connection.log("Forever frame iframe finished loading and is no longer receiving messages.");
                    if (!onFailed || !onFailed()) {
                        that.reconnect(connection);
                    }
                };

            if (window.EventSource) {
                // If the browser supports SSE, don't use Forever Frame
                if (onFailed) {
                    connection.log("Forever Frame is not supported by SignalR on browsers with SSE support.");
                    onFailed();
                }
                return;
            }

            frame.setAttribute("data-signalr-connection-id", connection.id);

            // Start preventing loading icon
            // This will only perform work if the loadPreventer is not attached to another connection.
            loadPreventer.prevent();

            // Build the url
            url = transportLogic.getUrl(connection, this.name);
            url += "&frameId=" + frameId;

            // add frame to the document prior to setting URL to avoid caching issues.
            window.document.documentElement.appendChild(frame);

            connection.log("Binding to iframe's load event.");

            if (frame.addEventListener) {
                frame.addEventListener("load", frameLoadHandler, false);
            } else if (frame.attachEvent) {
                frame.attachEvent("onload", frameLoadHandler);
            }

            frame.src = url;
            transportLogic.foreverFrame.connections[frameId] = connection;

            connection.frame = frame;
            connection.frameId = frameId;

            if (onSuccess) {
                connection.onSuccess = function () {
                    connection.log("Iframe transport started.");
                    onSuccess();
                };
            }
        },

        reconnect: function (connection) {
            var that = this;

            // Need to verify connection state and verify before the setTimeout occurs because an application sleep could occur during the setTimeout duration.
            if (transportLogic.isConnectedOrReconnecting(connection) && transportLogic.verifyLastActive(connection)) {
                window.setTimeout(function () {
                    // Verify that we're ok to reconnect.
                    if (!transportLogic.verifyLastActive(connection)) {
                        return;
                    }

                    if (connection.frame && transportLogic.ensureReconnectingState(connection)) {
                        var frame = connection.frame,
                            src = transportLogic.getUrl(connection, that.name, true) + "&frameId=" + connection.frameId;
                        connection.log("Updating iframe src to '" + src + "'.");
                        frame.src = src;
                    }
                }, connection.reconnectDelay);
            }
        },

        lostConnection: function (connection) {
            this.reconnect(connection);
        },

        send: function (connection, data) {
            transportLogic.ajaxSend(connection, data);
        },

        receive: function (connection, data) {
            var cw,
                body,
                response;

            if (connection.json !== connection._originalJson) {
                // If there's a custom JSON parser configured then serialize the object
                // using the original (browser) JSON parser and then deserialize it using
                // the custom parser (connection._parseResponse does that). This is so we
                // can easily send the response from the server as "raw" JSON but still
                // support custom JSON deserialization in the browser.
                data = connection._originalJson.stringify(data);
            }

            response = connection._parseResponse(data);

            transportLogic.processMessages(connection, response, connection.onSuccess);

            // Protect against connection stopping from a callback trigger within the processMessages above.
            if (connection.state === $.signalR.connectionState.connected) {
                // Delete the script & div elements
                connection.frameMessageCount = (connection.frameMessageCount || 0) + 1;
                if (connection.frameMessageCount > signalR.transports.foreverFrame.iframeClearThreshold) {
                    connection.frameMessageCount = 0;
                    cw = connection.frame.contentWindow || connection.frame.contentDocument;
                    if (cw && cw.document && cw.document.body) {
                        body = cw.document.body;

                        // Remove all the child elements from the iframe's body to conserver memory
                        while (body.firstChild) {
                            body.removeChild(body.firstChild);
                        }
                    }
                }
            }
        },

        stop: function (connection) {
            var cw = null;

            // Stop attempting to prevent loading icon
            loadPreventer.cancel();

            if (connection.frame) {
                if (connection.frame.stop) {
                    connection.frame.stop();
                } else {
                    try {
                        cw = connection.frame.contentWindow || connection.frame.contentDocument;
                        if (cw.document && cw.document.execCommand) {
                            cw.document.execCommand("Stop");
                        }
                    }
                    catch (e) {
                        connection.log("Error occurred when stopping foreverFrame transport. Message = " + e.message + ".");
                    }
                }

                // Ensure the iframe is where we left it
                if (connection.frame.parentNode === window.document.documentElement) {
                    window.document.documentElement.removeChild(connection.frame);
                }

                delete transportLogic.foreverFrame.connections[connection.frameId];
                connection.frame = null;
                connection.frameId = null;
                delete connection.frame;
                delete connection.frameId;
                delete connection.onSuccess;
                delete connection.frameMessageCount;
                connection.log("Stopping forever frame.");
            }
        },

        abort: function (connection, async) {
            transportLogic.ajaxAbort(connection, async);
        },

        getConnection: function (id) {
            return transportLogic.foreverFrame.connections[id];
        },

        started: function (connection) {
            if (changeState(connection,
                signalR.connectionState.reconnecting,
                signalR.connectionState.connected) === true) {

                $(connection).triggerHandler(events.onReconnect);
            }
        }
    };

}(jQuery, window));
/* jquery.signalR.transports.longPolling.js */
// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.


/*global window:false */
/// <reference path="jquery.signalR.transports.common.js" />

(function ($, window, undefined) {

    var signalR = $.signalR,
        events = $.signalR.events,
        changeState = $.signalR.changeState,
        isDisconnecting = $.signalR.isDisconnecting,
        transportLogic = signalR.transports._logic;

    signalR.transports.longPolling = {
        name: "longPolling",

        supportsKeepAlive: function () {
            return false;
        },

        reconnectDelay: 3000,

        start: function (connection, onSuccess, onFailed) {
            /// <summary>Starts the long polling connection</summary>
            /// <param name="connection" type="signalR">The SignalR connection to start</param>
            var that = this,
                fireConnect = function () {
                    fireConnect = $.noop;

                    connection.log("LongPolling connected.");

                    if (onSuccess) {
                        onSuccess();
                    } else {
                        connection.log("WARNING! The client received an init message after reconnecting.");
                    }
                },
                tryFailConnect = function (error) {
                    if (onFailed(error)) {
                        connection.log("LongPolling failed to connect.");
                        return true;
                    }

                    return false;
                },
                privateData = connection._,
                reconnectErrors = 0,
                fireReconnected = function (instance) {
                    window.clearTimeout(privateData.reconnectTimeoutId);
                    privateData.reconnectTimeoutId = null;

                    if (changeState(instance,
                        signalR.connectionState.reconnecting,
                        signalR.connectionState.connected) === true) {
                        // Successfully reconnected!
                        instance.log("Raising the reconnect event");
                        $(instance).triggerHandler(events.onReconnect);
                    }
                },
                // 1 hour
                maxFireReconnectedTimeout = 3600000;

            if (connection.pollXhr) {
                connection.log("Polling xhr requests already exists, aborting.");
                connection.stop();
            }

            connection.messageId = null;

            privateData.reconnectTimeoutId = null;

            privateData.pollTimeoutId = window.setTimeout(function () {
                (function poll(instance, raiseReconnect) {
                    var messageId = instance.messageId,
                        connect = (messageId === null),
                        reconnecting = !connect,
                        polling = !raiseReconnect,
                        url = transportLogic.getUrl(instance, that.name, reconnecting, polling, true /* use Post for longPolling */),
                        postData = {};

                    if (instance.messageId) {
                        postData.messageId = instance.messageId;
                    }

                    if (instance.groupsToken) {
                        postData.groupsToken = instance.groupsToken;
                    }

                    // If we've disconnected during the time we've tried to re-instantiate the poll then stop.
                    if (isDisconnecting(instance) === true) {
                        return;
                    }

                    connection.log("Opening long polling request to '" + url + "'.");
                    instance.pollXhr = transportLogic.ajax(connection, {
                        xhrFields: {
                            onprogress: function () {
                                transportLogic.markLastMessage(connection);
                            }
                        },
                        url: url,
                        type: "POST",
                        contentType: signalR._.defaultContentType,
                        data: postData,
                        timeout: connection._.pollTimeout,
                        headers: connection.accessToken ? { "Authorization": "Bearer " + connection.accessToken } : {},
                        success: function (result) {
                            var minData,
                                delay = 0,
                                data,
                                shouldReconnect;

                            connection.log("Long poll complete.");

                            // Reset our reconnect errors so if we transition into a reconnecting state again we trigger
                            // reconnected quickly
                            reconnectErrors = 0;

                            try {
                                // Remove any keep-alives from the beginning of the result
                                minData = connection._parseResponse(result);
                            }
                            catch (error) {
                                transportLogic.handleParseFailure(instance, result, error, tryFailConnect, instance.pollXhr);
                                return;
                            }

                            // If there's currently a timeout to trigger reconnect, fire it now before processing messages
                            if (privateData.reconnectTimeoutId !== null) {
                                fireReconnected(instance);
                            }

                            if (minData) {
                                data = transportLogic.maximizePersistentResponse(minData);
                            }

                            transportLogic.processMessages(instance, minData, fireConnect);

                            if (data &&
                                $.type(data.LongPollDelay) === "number") {
                                delay = data.LongPollDelay;
                            }

                            if (isDisconnecting(instance) === true) {
                                return;
                            }

                            shouldReconnect = data && data.ShouldReconnect;
                            if (shouldReconnect) {
                                // Transition into the reconnecting state
                                // If this fails then that means that the user transitioned the connection into a invalid state in processMessages.
                                if (!transportLogic.ensureReconnectingState(instance)) {
                                    return;
                                }
                            }

                            // We never want to pass a raiseReconnect flag after a successful poll.  This is handled via the error function
                            if (delay > 0) {
                                privateData.pollTimeoutId = window.setTimeout(function () {
                                    poll(instance, shouldReconnect);
                                }, delay);
                            } else {
                                poll(instance, shouldReconnect);
                            }
                        },

                        error: function (data, textStatus) {
                            var error = signalR._.transportError(signalR.resources.longPollFailed, connection.transport, data, instance.pollXhr);

                            // Stop trying to trigger reconnect, connection is in an error state
                            // If we're not in the reconnect state this will noop
                            window.clearTimeout(privateData.reconnectTimeoutId);
                            privateData.reconnectTimeoutId = null;

                            if (textStatus === "abort") {
                                connection.log("Aborted xhr request.");
                                return;
                            }

                            if (!tryFailConnect(error)) {

                                // Increment our reconnect errors, we assume all errors to be reconnect errors
                                // In the case that it's our first error this will cause Reconnect to be fired
                                // after 1 second due to reconnectErrors being = 1.
                                reconnectErrors++;

                                if (connection.state !== signalR.connectionState.reconnecting) {
                                    connection.log("An error occurred using longPolling. Status = " + textStatus + ".  Response = " + data.responseText + ".");
                                    $(instance).triggerHandler(events.onError, [error]);
                                }

                                // We check the state here to verify that we're not in an invalid state prior to verifying Reconnect.
                                // If we're not in connected or reconnecting then the next ensureReconnectingState check will fail and will return.
                                // Therefore we don't want to change that failure code path.
                                if ((connection.state === signalR.connectionState.connected ||
                                    connection.state === signalR.connectionState.reconnecting) &&
                                    !transportLogic.verifyLastActive(connection)) {
                                    return;
                                }

                                // Transition into the reconnecting state
                                // If this fails then that means that the user transitioned the connection into the disconnected or connecting state within the above error handler trigger.
                                if (!transportLogic.ensureReconnectingState(instance)) {
                                    return;
                                }

                                // Call poll with the raiseReconnect flag as true after the reconnect delay
                                privateData.pollTimeoutId = window.setTimeout(function () {
                                    poll(instance, true);
                                }, that.reconnectDelay);
                            }
                        }
                    });

                    // This will only ever pass after an error has occurred via the poll ajax procedure.
                    if (reconnecting && raiseReconnect === true) {
                        // We wait to reconnect depending on how many times we've failed to reconnect.
                        // This is essentially a heuristic that will exponentially increase in wait time before
                        // triggering reconnected.  This depends on the "error" handler of Poll to cancel this
                        // timeout if it triggers before the Reconnected event fires.
                        // The Math.min at the end is to ensure that the reconnect timeout does not overflow.
                        privateData.reconnectTimeoutId = window.setTimeout(function () { fireReconnected(instance); }, Math.min(1000 * (Math.pow(2, reconnectErrors) - 1), maxFireReconnectedTimeout));
                    }
                }(connection));
            }, 250); // Have to delay initial poll so Chrome doesn't show loader spinner in tab
        },

        lostConnection: function (connection) {
            if (connection.pollXhr) {
                connection.pollXhr.abort("lostConnection");
            }
        },

        send: function (connection, data) {
            transportLogic.ajaxSend(connection, data);
        },

        stop: function (connection) {
            /// <summary>Stops the long polling connection</summary>
            /// <param name="connection" type="signalR">The SignalR connection to stop</param>

            window.clearTimeout(connection._.pollTimeoutId);
            window.clearTimeout(connection._.reconnectTimeoutId);

            delete connection._.pollTimeoutId;
            delete connection._.reconnectTimeoutId;

            if (connection.pollXhr) {
                connection.pollXhr.abort();
                connection.pollXhr = null;
                delete connection.pollXhr;
            }
        },

        abort: function (connection, async) {
            transportLogic.ajaxAbort(connection, async);
        }
    };

}(jQuery, window));
/* jquery.signalR.hubs.js */
// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.

/*global window:false */
/// <reference path="jquery.signalR.core.js" />

(function ($, window, undefined) {

    var nextGuid = 0;
    var eventNamespace = ".hubProxy",
        signalR = $.signalR;

    function makeEventName(event) {
        return event + eventNamespace;
    }

    // Equivalent to Array.prototype.map
    function map(arr, fun, thisp) {
        var i,
            length = arr.length,
            result = [];
        for (i = 0; i < length; i += 1) {
            if (arr.hasOwnProperty(i)) {
                result[i] = fun.call(thisp, arr[i], i, arr);
            }
        }
        return result;
    }

    function getArgValue(a) {
        return $.isFunction(a) ? null : ($.type(a) === "undefined" ? null : a);
    }

    function hasMembers(obj) {
        for (var key in obj) {
            // If we have any properties in our callback map then we have callbacks and can exit the loop via return
            if (obj.hasOwnProperty(key)) {
                return true;
            }
        }

        return false;
    }

    function clearInvocationCallbacks(connection, error) {
        /// <param name="connection" type="hubConnection" />
        var callbacks = connection._.invocationCallbacks,
            callback;

        if (hasMembers(callbacks)) {
            connection.log("Clearing hub invocation callbacks with error: " + error + ".");
        }

        // Reset the callback cache now as we have a local var referencing it
        connection._.invocationCallbackId = 0;
        delete connection._.invocationCallbacks;
        connection._.invocationCallbacks = {};

        // Loop over the callbacks and invoke them.
        // We do this using a local var reference and *after* we've cleared the cache
        // so that if a fail callback itself tries to invoke another method we don't
        // end up with its callback in the list we're looping over.
        for (var callbackId in callbacks) {
            callback = callbacks[callbackId];
            callback.method.call(callback.scope, { E: error });
        }
    }

    // hubProxy
    function hubProxy(hubConnection, hubName) {
        /// <summary>
        ///     Creates a new proxy object for the given hub connection that can be used to invoke
        ///     methods on server hubs and handle client method invocation requests from the server.
        /// </summary>
        return new hubProxy.fn.init(hubConnection, hubName);
    }

    hubProxy.fn = hubProxy.prototype = {
        init: function (connection, hubName) {
            this.state = {};
            this.connection = connection;
            this.hubName = hubName;
            this._ = {
                callbackMap: {}
            };
        },

        constructor: hubProxy,

        hasSubscriptions: function () {
            return hasMembers(this._.callbackMap);
        },

        on: function (eventName, callback, callbackIdentity) {
            /// <summary>Wires up a callback to be invoked when a invocation request is received from the server hub.</summary>
            /// <param name="eventName" type="String">The name of the hub event to register the callback for.</param>
            /// <param name="callback" type="Function">The callback to be invoked.</param>
            /// <param name="callbackIdentity" type="Object">An optional object to use as the "identity" for the callback when checking if the handler has already been registered. Defaults to the value of 'callback' if not provided.</param>
            var that = this,
                callbackMap = that._.callbackMap;

            // We need the third "identity" argument because the registerHubProxies call made by signalr/js wraps the user-provided callback in a custom wrapper which breaks the identity comparison.
            // callbackIdentity allows the caller of `on` to provide a separate object to use as the "identity". `registerHubProxies` uses the original user callback as this identity object.
            callbackIdentity = callbackIdentity || callback;

            // Assign a global ID to the identity object. This tags the object so we can detect the same object when it comes back.
            if (!callbackIdentity._signalRGuid) {
                callbackIdentity._signalRGuid = nextGuid++;
            }

            // Normalize the event name to lowercase
            eventName = eventName.toLowerCase();

            // If there is not an event registered for this callback yet we want to create its event space in the callback map.
            var callbackSpace = callbackMap[eventName];
            if (!callbackSpace) {
                callbackSpace = [];
                callbackMap[eventName] = callbackSpace;
            }

            // Check if there's already a registration
            var registration;
            for (var i = 0; i < callbackSpace.length; i++) {
                if (callbackSpace[i].guid === callbackIdentity._signalRGuid) {
                    registration = callbackSpace[i];
                }
            }

            // Create a registration if there isn't one already
            if (!registration) {
                registration = {
                    guid: callbackIdentity._signalRGuid,
                    eventHandlers: []
                };
                callbackMap[eventName].push(registration);
            }

            var handler = function (e, data) {
                callback.apply(that, data);
            };
            registration.eventHandlers.push(handler);

            $(that).bind(makeEventName(eventName), handler);

            return that;
        },

        off: function (eventName, callback, callbackIdentity) {
            /// <summary>Removes the callback invocation request from the server hub for the given event name.</summary>
            /// <param name="eventName" type="String">The name of the hub event to unregister the callback for.</param>
            /// <param name="callback" type="Function">The callback to be removed.</param>
            /// <param name="callbackIdentity" type="Object">An optional object to use as the "identity" when looking up the callback. Corresponds to the same parameter provided to 'on'. Defaults to the value of 'callback' if not provided.</param>
            var that = this,
                callbackMap = that._.callbackMap,
                callbackSpace;

            callbackIdentity = callbackIdentity || callback;

            // Normalize the event name to lowercase
            eventName = eventName.toLowerCase();

            callbackSpace = callbackMap[eventName];

            // Verify that there is an event space to unbind
            if (callbackSpace) {

                if (callback) {
                    // Find the callback registration
                    var callbackRegistration;
                    var callbackIndex;
                    for (var i = 0; i < callbackSpace.length; i++) {
                        if (callbackSpace[i].guid === callbackIdentity._signalRGuid) {
                            callbackIndex = i;
                            callbackRegistration = callbackSpace[i];
                        }
                    }

                    // Only unbind if there's an event bound with eventName and a callback with the specified callback
                    if (callbackRegistration) {
                        // Unbind all event handlers associated with the registration.
                        for (var j = 0; j < callbackRegistration.eventHandlers.length; j++) {
                            $(that).unbind(makeEventName(eventName), callbackRegistration.eventHandlers[j]);
                        }

                        // Remove the registration from the list
                        callbackSpace.splice(i, 1);

                        // Check if there are any registrations left, if not we need to destroy it.
                        if (callbackSpace.length === 0) {
                            delete callbackMap[eventName];
                        }
                    }
                } else if (!callback) { // Check if we're removing the whole event and we didn't error because of an invalid callback
                    $(that).unbind(makeEventName(eventName));

                    delete callbackMap[eventName];
                }
            }

            return that;
        },

        invoke: function (methodName) {
            /// <summary>Invokes a server hub method with the given arguments.</summary>
            /// <param name="methodName" type="String">The name of the server hub method.</param>

            var that = this,
                connection = that.connection,
                args = $.makeArray(arguments).slice(1),
                argValues = map(args, getArgValue),
                data = { H: that.hubName, M: methodName, A: argValues, I: connection._.invocationCallbackId },
                d = $.Deferred(),
                callback = function (minResult) {
                    var result = that._maximizeHubResponse(minResult),
                        source,
                        error;

                    // Update the hub state
                    $.extend(that.state, result.State);

                    if (result.Progress) {
                        if (d.notifyWith) {
                            // Progress is only supported in jQuery 1.7+
                            d.notifyWith(that, [result.Progress.Data]);
                        } else if (!connection._.progressjQueryVersionLogged) {
                            connection.log("A hub method invocation progress update was received but the version of jQuery in use (" + $.prototype.jquery + ") does not support progress updates. Upgrade to jQuery 1.7+ to receive progress notifications.");
                            connection._.progressjQueryVersionLogged = true;
                        }
                    } else if (result.Error) {
                        // Server hub method threw an exception, log it & reject the deferred
                        if (result.StackTrace) {
                            connection.log(result.Error + "\n" + result.StackTrace + ".");
                        }

                        // result.ErrorData is only set if a HubException was thrown
                        source = result.IsHubException ? "HubException" : "Exception";
                        error = signalR._.error(result.Error, source);
                        error.data = result.ErrorData;

                        connection.log(that.hubName + "." + methodName + " failed to execute. Error: " + error.message);
                        d.rejectWith(that, [error]);
                    } else {
                        // Server invocation succeeded, resolve the deferred
                        connection.log("Invoked " + that.hubName + "." + methodName);
                        d.resolveWith(that, [result.Result]);
                    }
                };

            connection._.invocationCallbacks[connection._.invocationCallbackId.toString()] = { scope: that, method: callback };
            connection._.invocationCallbackId += 1;

            if (!$.isEmptyObject(that.state)) {
                data.S = that.state;
            }

            connection.log("Invoking " + that.hubName + "." + methodName);
            connection.send(data);

            return d.promise();
        },

        _maximizeHubResponse: function (minHubResponse) {
            return {
                State: minHubResponse.S,
                Result: minHubResponse.R,
                Progress: minHubResponse.P ? {
                    Id: minHubResponse.P.I,
                    Data: minHubResponse.P.D
                } : null,
                Id: minHubResponse.I,
                IsHubException: minHubResponse.H,
                Error: minHubResponse.E,
                StackTrace: minHubResponse.T,
                ErrorData: minHubResponse.D
            };
        }
    };

    hubProxy.fn.init.prototype = hubProxy.fn;

    // hubConnection
    function hubConnection(url, options) {
        /// <summary>Creates a new hub connection.</summary>
        /// <param name="url" type="String">[Optional] The hub route url, defaults to "/signalr".</param>
        /// <param name="options" type="Object">[Optional] Settings to use when creating the hubConnection.</param>
        var settings = {
            qs: null,
            logging: false,
            useDefaultPath: true
        };

        $.extend(settings, options);

        if (!url || settings.useDefaultPath) {
            url = (url || "") + "/signalr";
        }
        return new hubConnection.fn.init(url, settings);
    }

    hubConnection.fn = hubConnection.prototype = $.connection();

    hubConnection.fn.init = function (url, options) {
        var settings = {
            qs: null,
            logging: false,
            useDefaultPath: true
        },
            connection = this;

        $.extend(settings, options);

        // Call the base constructor
        $.signalR.fn.init.call(connection, url, settings.qs, settings.logging);

        // Object to store hub proxies for this connection
        connection.proxies = {};

        connection._.invocationCallbackId = 0;
        connection._.invocationCallbacks = {};

        // Wire up the received handler
        connection.received(function (minData) {
            var data, proxy, dataCallbackId, callback, hubName, eventName;
            if (!minData) {
                return;
            }

            // We have to handle progress updates first in order to ensure old clients that receive
            // progress updates enter the return value branch and then no-op when they can't find
            // the callback in the map (because the minData.I value will not be a valid callback ID)
            // Process progress notification
            if (typeof (minData.P) !== "undefined") {
                dataCallbackId = minData.P.I.toString();
                callback = connection._.invocationCallbacks[dataCallbackId];
                if (callback) {
                    callback.method.call(callback.scope, minData);
                }
            } else if (typeof (minData.I) !== "undefined") {
                // We received the return value from a server method invocation, look up callback by id and call it
                dataCallbackId = minData.I.toString();
                callback = connection._.invocationCallbacks[dataCallbackId];
                if (callback) {
                    // Delete the callback from the proxy
                    connection._.invocationCallbacks[dataCallbackId] = null;
                    delete connection._.invocationCallbacks[dataCallbackId];

                    // Invoke the callback
                    callback.method.call(callback.scope, minData);
                }
            } else {
                data = this._maximizeClientHubInvocation(minData);

                // We received a client invocation request, i.e. broadcast from server hub
                connection.log("Triggering client hub event '" + data.Method + "' on hub '" + data.Hub + "'.");

                // Normalize the names to lowercase
                hubName = data.Hub.toLowerCase();
                eventName = data.Method.toLowerCase();

                // Trigger the local invocation event
                proxy = this.proxies[hubName];

                // Update the hub state
                $.extend(proxy.state, data.State);
                $(proxy).triggerHandler(makeEventName(eventName), [data.Args]);
            }
        });

        connection.error(function (errData, origData) {
            var callbackId, callback;

            if (!origData) {
                // No original data passed so this is not a send error
                return;
            }

            callbackId = origData.I;
            callback = connection._.invocationCallbacks[callbackId];

            // Verify that there is a callback bound (could have been cleared)
            if (callback) {
                // Delete the callback
                connection._.invocationCallbacks[callbackId] = null;
                delete connection._.invocationCallbacks[callbackId];

                // Invoke the callback with an error to reject the promise
                callback.method.call(callback.scope, { E: errData });
            }
        });

        connection.reconnecting(function () {
            if (connection.transport && connection.transport.name === "webSockets") {
                clearInvocationCallbacks(connection, "Connection started reconnecting before invocation result was received.");
            }
        });

        connection.disconnected(function () {
            clearInvocationCallbacks(connection, "Connection was disconnected before invocation result was received.");
        });
    };

    hubConnection.fn._maximizeClientHubInvocation = function (minClientHubInvocation) {
        return {
            Hub: minClientHubInvocation.H,
            Method: minClientHubInvocation.M,
            Args: minClientHubInvocation.A,
            State: minClientHubInvocation.S
        };
    };

    hubConnection.fn._registerSubscribedHubs = function () {
        /// <summary>
        ///     Sets the starting event to loop through the known hubs and register any new hubs
        ///     that have been added to the proxy.
        /// </summary>
        var connection = this;

        if (!connection._subscribedToHubs) {
            connection._subscribedToHubs = true;
            connection.starting(function () {
                // Set the connection's data object with all the hub proxies with active subscriptions.
                // These proxies will receive notifications from the server.
                var subscribedHubs = [];

                $.each(connection.proxies, function (key) {
                    if (this.hasSubscriptions()) {
                        subscribedHubs.push({ name: key });
                        connection.log("Client subscribed to hub '" + key + "'.");
                    }
                });

                if (subscribedHubs.length === 0) {
                    connection.log("No hubs have been subscribed to.  The client will not receive data from hubs.  To fix, declare at least one client side function prior to connection start for each hub you wish to subscribe to.");
                }

                connection.data = connection.json.stringify(subscribedHubs);
            });
        }
    };

    hubConnection.fn.createHubProxy = function (hubName) {
        /// <summary>
        ///     Creates a new proxy object for the given hub connection that can be used to invoke
        ///     methods on server hubs and handle client method invocation requests from the server.
        /// </summary>
        /// <param name="hubName" type="String">
        ///     The name of the hub on the server to create the proxy for.
        /// </param>

        // Normalize the name to lowercase
        hubName = hubName.toLowerCase();

        var proxy = this.proxies[hubName];
        if (!proxy) {
            proxy = hubProxy(this, hubName);
            this.proxies[hubName] = proxy;
        }

        this._registerSubscribedHubs();

        return proxy;
    };

    hubConnection.fn.init.prototype = hubConnection.fn;

    $.hubConnection = hubConnection;

}(jQuery, window));
/* jquery.signalR.version.js */
// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.


/*global window:false */
/// <reference path="jquery.signalR.core.js" />
(function ($, undefined) {
    // This will be modified by the build script
    $.signalR.version = "2.4.0";
}(jQuery));
/* eslint-env commonjs, amd */

// UMD based on https://github.com/umdjs/umd/blob/master/templates/returnExports.js
// TODO: move to ES6 and transpiler

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['jquery'], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(require('jquery'));
    } else {
        // Browser globals (root is window)
        root.wvy = root.wvy || {};
        root.wvy.connection = root.wvy.connection || new factory(jQuery);
    }
}(typeof self !== 'undefined' ? self : this, function ($) {

    console.debug("connection.js", window.name);

    function sanitizeObject(obj) {
        return JSON.parse(JSON.stringify(obj, function replacer(key, value) {
            // Filtering out properties
            // Remove HTML nodes
            if (value instanceof HTMLElement) {
                return value.toString();
            }
            return value;
        }));
    }

    var connections = this;

    // CONNECTION HANDLING
    var _connections = new Map();

    var WeavyConnection = function (url) {
        /**
         *  Reference to this instance
         *  @lends WeavyConnection#
         */
        var weavyConnection = this;

        var initialized = false;

        var connectionUrl = "/signalr";

        if (url) {
            // Remove trailing slash
            url = /\/$/.test(url) ? url.slice(0,-1) : url;

            connectionUrl = url + connectionUrl;
        }

        // create a new hub connection
        var connection = $.hubConnection(connectionUrl, { useDefaultPath: false });
        var reconnecting = false;
        var hubProxies = { rtm: connection.createHubProxy('rtm'), client: connection.createHubProxy('client') };
        var _events = [];
        var _reconnectTimeout = null;
        var _connectionTimeout = null;
        var reconnectRetries = 0;
        var explicitlyDisconnected = false;

        var whenConnectionStart;
        var whenConnected = $.Deferred();
        var whenLeaderElected = $.Deferred();
        var whenAuthenticated = $.Deferred();

        var states = $.signalR.connectionState;

        // Provide reverse readable state strings
        // And convert strings to int
        for (var stateName in states) {
            if (Object.prototype.hasOwnProperty.call(states, stateName)) {
                states[states[stateName]] = stateName;
                states[stateName] = parseInt(states[stateName]);
            }
        }

        var state = parseInt(states.disconnected);
        var childConnection = null;
        var connectedAt = null;


        //----------------------------------------------------------
        // Init the connection
        // url: the url to the /signalr 
        // windows: initial [] of windows to post incoming events to when embedded
        // force: if to connect event if the user is not logged in
        //----------------------------------------------------------
        function init(connectAfterInit, authentication) {
            if (!initialized) {
                initialized = true;
                console.debug("wvy.connection: init", url || window.name || "self", connectAfterInit ? "and connect" : "");

                wvy.postal.whenLeader.then(function () {
                    console.log("wvy.connection: is leader, let's go");
                    childConnection = false;
                    whenLeaderElected.resolve(true);
                }, function () {
                    childConnection = true;
                    whenLeaderElected.resolve(false);
                });

                authentication = authentication || wvy.authentication.get(url);

                authentication.whenAuthenticated().then(function () {
                    whenAuthenticated.resolve();
                });

                authentication.on("user", function (e, auth) {
                    if (auth.state !== "updated") {
                        disconnectAndConnect();
                    }
                });

                on("reconnected.connection.weavy", function (e) {
                    if (authentication.isAuthenticated()) {
                        // Check if user state is still valid
                        authentication.updateUserState("wvy.connection:reconnected");
                    }
                });

                wvy.postal.on("distribute", onParentMessageReceived);
                wvy.postal.on("message", onChildMessageReceived);
            }

            if (connectAfterInit) {
                // connect to the server?
                return connect();
            } else {
                return whenLeaderElected.promise();
            }
        }

        function connect() {
            return whenLeaderElected.then(function (leader) {
                if (leader) {
                    connectionStart();
                } else {
                    wvy.postal.postToParent({ name: "request:connection-start" });
                }
                return whenConnected.promise();
            });
        }

        // start the connection
        function connectionStart() {
            return whenAuthenticated.then(function () {
                 explicitlyDisconnected = false;

                if (status() === states.disconnected) {
                    state = states.connecting;
                    triggerEvent("state-changed.connection.weavy", { state: state });

                    whenConnectionStart = connection.start().always(function () {
                        console.debug("wvy.connection:" + (childConnection ? " " + (window.name || "[child]") : "") + " connection started")
                        whenConnected.resolve();
                    }).catch(function (error) {
                        console.error("wvy.connection:" + (childConnection ? " " + (window.name || "[child]") : "") + " could not start connection")
                    });
                }

                return whenConnectionStart;
            });
        }

        // stop connection
        function disconnect(async, notify) {
            if (!childConnection && connection.state !== states.disconnected && explicitlyDisconnected === false) {
                explicitlyDisconnected = true;
                whenConnected = $.Deferred();

                try {
                    connection.stop(async === true, notify !== false).then(function () {
                        return Promise.resolve();
                    }).catch(function () {
                        return Promise.resolve();
                    });
                } catch (e) {
                    return Promise.resolve();
                }
            } else {
                return Promise.resolve();
            }
        }

        function disconnectAndConnect() {
            return new Promise(function (resolve) {
                explicitlyDisconnected = false;
                disconnect(true, false).then(function () {
                    connect().then(resolve);
                });
            });
        }

        function status() {
            return parseInt(state);
        }

        // attach an event handler for the specified connection or server event, e.g. "presence", "typing" etc (see PushService for a list of built-in events)
        function on(event, handler) {
            if (event.indexOf(".connection") !== -1) {
                // .connection.weavy (connection events)
                event = event.indexOf(".weavy") === -1 ? event + ".weavy" : event;
            } else {
                // .rtmweavy (realtime events)
                event = event.indexOf(".rtmweavy") === -1 ? event + ".rtmweavy" : event;
            }
            _events.push([event, handler]);
            $(weavyConnection).on(event, null, null, handler);
        }

        function off(event, handler) {
            if (event.indexOf(".connection") !== -1) {
                // .connection.weavy (connection events)
                event = event.indexOf(".weavy") === -1 ? event + ".weavy" : event;
            } else {
                // .rtmweavy (realtime events)
                event = event.indexOf(".rtmweavy") === -1 ? event + ".rtmweavy" : event;
            }

            _events = _events.filter(function (eventHandler) {
                if (eventHandler[0] === event && eventHandler[1] === handler) {
                    $(weavyConnection).off(event, null, handler);
                    return false;
                } else {
                    return true;
                }
            })
        }

        function triggerEvent(name) {
            var event = $.Event(name);

            // trigger event (with json object instead of string), handle any number of json objects passed from hub (args)
            var argumentArray = [].slice.call(arguments, 1);
            var data = argumentArray.map(function (a) {
                if (a && !$.isArray(a) && !$.isPlainObject(a)) {
                    try {
                        return JSON.parse(a);
                    } catch (e) {
                        console.warn("wvy.connection" + (childConnection ? " " + (window.name || "[child]") : "") + " could not parse event data;", name);
                    }
                }
                return a;
            });

            $(weavyConnection).triggerHandler(event, data);
            triggerToChildren("distribute-event", name, data);
        }

        // trigger a message distribute
        function triggerToChildren(name, eventName, data) {
            try {
                wvy.postal.postToChildren({ name: name, eventName: eventName, data: data });
            } catch (e) {
                console.error("wvy.connection:" + (childConnection ? " " + (window.name || "[child]") : "") + " could not distribute relay realtime message", { name: name, eventName: eventName }, e);
            }
        }

        // invoke a method on a server hub, e.g. "SetActive" on the RealTimeHub (rtm) or "Typing" on the MessengerHub (messenger).
        function invoke(hub, method, data) {
            var args = data ? [method, sanitizeObject(data)] : [method];

            var whenInvoked = new Promise(function (resolve, reject) {

                whenLeaderElected.then(function (leader) {
                    if (leader) {

                        console.debug("wvy.connection: invoke as leader", hub, args[0]);
                        var proxy = hubProxies[hub];

                        connect().then(function () {
                            proxy.invoke.apply(proxy, args)
                                .then(function (invokeResult) {

                                    // Try JSON parse
                                    if (typeof invokeResult === "string") {
                                        try {
                                            invokeResult = JSON.parse(invokeResult);
                                        } catch (e) { /* Ignore catch */ }
                                    }

                                    resolve(invokeResult);
                                })
                                .catch(function (error) {
                                    console.error(error, hub, args);
                                    reject(error);
                                });
                        });
                    } else {
                        // Invoke via parent
                        var invokeId = "wvy.connection-" + Math.random().toString().substr(2);
                        console.debug("wvy.connection: invoke via parent", hub, args[0], invokeId);

                        var invokeResult = function (msg) {
                            if (msg.data.name === "invokeResult" && msg.data.invokeId === invokeId) {
                                console.debug("wvy.connection: parent invokeResult received", invokeId);
                                if (msg.data.error) {
                                    reject(msg.data.error);
                                } else {
                                    var invokeResult = msg.data.result;

                                    // Try JSON parse
                                    if (typeof invokeResult === "string") {
                                        try {
                                            invokeResult = JSON.parse(invokeResult);
                                        } catch (e) { /* Ignore catch */ }
                                    }
                                    resolve(invokeResult);
                                }
                                wvy.postal.off("invokeResult", invokeResult);
                            }
                        };

                        wvy.postal.on("invokeResult", invokeResult);

                        wvy.postal.postToParent({ name: "invoke", hub: hub, args: args, invokeId: invokeId });
                    }
                });
            });

            return whenInvoked;
        }


        // configure logging and connection lifetime events
        connection.logging = false;

        connection.stateChanged(function (connectionState) {
            // Make sure connectionState is int
            var newState = parseInt(connectionState.newState);

            if (newState === states.connected) {
                console.debug("wvy.connection:" + (childConnection ? " " + (window.name || "[child]") : "") + " connected " + connection.id + " (" + connection.transport.name + ")");

                // clear timeouts
                window.clearTimeout(_reconnectTimeout);

                // reset retries
                reconnectRetries = 0;

                if (wvy.alert) {
                    wvy.alert.close("connection-state");
                } else {
                    triggerToChildren("alert", "close", "connection-state");
                }

                whenConnected.resolve();

                // Trigger reconnected on connect excluding the first connect
                if (connectedAt) {
                    triggerEvent("reconnected.connection.weavy");
                }

                connectedAt = new Date();
            }

            state = newState;
            // trigger event
            triggerEvent("state-changed.connection.weavy", { state: newState });
        });

        connection.reconnected(function () {
            reconnecting = false;
        });

        connection.reconnecting(function () {
            reconnecting = true;
            console.debug("wvy.connection:" + (childConnection ? " " + (window.name || "[child]") : "") + " reconnecting...");

            // wait 2 seconds before showing message
            if (_reconnectTimeout !== null) {
                window.clearTimeout(_reconnectTimeout);
            }

            _reconnectTimeout = setTimeout(function () {
                if (wvy.alert) {
                    wvy.alert.alert("primary", "Reconnecting...", null, "connection-state");
                } else {
                    triggerToChildren("alert", "show", { type: "primary", title: "Reconnecting...", id: "connection-state" });
                }
            }, 2000);
        });

        connection.disconnected(function () {
            console.debug("wvy.connection:" + (childConnection ? " " + (window.name || "[child]") : "") + " disconnected");

            if (!explicitlyDisconnected) {
                reconnectRetries++;
                window.clearTimeout(_connectionTimeout);

                if (reconnecting) {
                    connection.start();
                    reconnecting = false;
                } else {
                    // connection dropped, try to connect again after 5s
                    _connectionTimeout = setTimeout(function () {
                        connection.start();
                    }, 5000);
                }
            }

            // trigger event
            triggerEvent("disconnected.connection.weavy", { retries: reconnectRetries, explicitlyDisconnected: explicitlyDisconnected });

        });


        // REALTIME EVENTS

        // generic callback used by server to notify clients that a realtime event happened
        // NOTE: we only need to hook this up in standalone, in the weavy client we wrap realtime events in the cross-frame-event and post to the frames
        function rtmEventRecieved(name, args) {
            name = name.indexOf(".rtmweavy" === -1) ? name + ".rtmweavy" : name;
            triggerEvent(name, args);
        }

        hubProxies["rtm"].on("eventReceived", rtmEventRecieved);

        // REALTIME CROSS WINDOW MESSAGE
        // handle cross frame events from rtm
        var onChildMessageReceived = function (e) {
            var msg = e.data;
            switch (msg.name) {
                case "invoke":
                    whenLeaderElected.then(function (leader) {
                        if (leader) {
                            var proxy = hubProxies[msg.hub];
                            var args = msg.args;
                            console.debug("wvy.connection: processing invoke request", msg.invokeId, msg.args);
                            connect().then(function () {
                                proxy.invoke.apply(proxy, args)
                                    .then(function (invokeResult) {
                                        console.debug("wvy.connection: returning invoke request result", msg.args[0], msg.invokeId);
                                        wvy.postal.postToSource(e, {
                                            name: "invokeResult",
                                            hub: msg.hub,
                                            args: args,
                                            result: invokeResult,
                                            invokeId: msg.invokeId
                                        });
                                    })
                                    .catch(function (error) {
                                        console.error(error);
                                        wvy.postal.postToSource(e, {
                                            name: "invokeResult",
                                            hub: msg.hub,
                                            args: args,
                                            error: error,
                                            invokeId: msg.invokeId
                                        });
                                    });
                            });
                        }

                    });
                    break;
                case "request:connection-start":
                    whenLeaderElected.then(function (leader) {
                        if (leader) {
                            console.debug("wvy.connection: processing connect request");
                            connect().then(function () {
                                wvy.postal.postToChildren({ name: "connection-started" });
                            });
                        }
                    });
                    break;
                default:
                    return;
            }
        };

        var onParentMessageReceived = function (e) {
            var msg = e.data;
            switch (msg.name) {
                case "connection-started":
                    whenLeaderElected.then(function (leader) {
                        if (!leader) {
                            console.debug("wvy.connection:" + (childConnection ? " " + (window.name || "[child]") : "") + " distribute received", msg.name, msg.eventName || "");
                            state = states.connected;
                            whenConnected.resolve();
                        }
                    });
                    break;
                case "distribute-event":
                    var name = msg.eventName;
                    var event = $.Event(name);
                    var data = msg.data;

                    // Extract array with single value
                    if ($.isArray(data) && data.length === 1) {
                        data = data[0];
                    }

                    if (name === "state-changed.connection.weavy") {
                        state = parseInt(data.state);
                        if (state === states.connected) {
                            whenConnected.resolve();
                        }
                    }

                    console.debug("wvy.connection:" + (childConnection ? " " + (window.name || "[child]") : "") + " triggering received distribute-event", name);
                    $(weavyConnection).triggerHandler(event, msg.data);
                    break;
                case "alert":
                    if (wvy.alert) {
                        if (msg.eventName === "show") {
                            console.debug("wvy.connection: alert show received", msg.data.title);
                            wvy.alert.alert(msg.data.type, msg.data.title, null, msg.data.id);
                        } else {
                            wvy.alert.close(msg.data);
                        }
                    }
                    break;
                default:
                    return;
            }
        };


        function destroy() {
            disconnect();

            reconnecting = false;

            window.clearTimeout(_reconnectTimeout);
            window.clearTimeout(_connectionTimeout);

            try {
                wvy.postal.off("distribute", onParentMessageReceived);
                wvy.postal.off("message", onChildMessageReceived);
            } catch (e) { /* Ignore catch */ }

            try {
                hubProxies["rtm"].off("eventReceived", rtmEventRecieved);
            } catch (e) { /* Ignore catch */ }

            _events.forEach(function (eventHandler) {
                var name = eventHandler[0], handler = eventHandler[1];
                $(weavyConnection).off(name, null, handler);
            });
            _events = [];
        }

        return {
            connect: connect,
            destroy: destroy,
            disconnect: disconnect,
            disconnectAndConnect: disconnectAndConnect,
            init: init,
            invoke: invoke,
            on: on,
            off: off,
            proxies: hubProxies,
            states: states,
            status: status,
            transport: function () { return connection.transport.name; }
        };
    };

    connections.get = function (url) {
        var sameOrigin = false;
        var urlExtract = url && /^(https?:\/(\/[^/]+)+)\/?$/.exec(url)
        if (urlExtract) {
            sameOrigin = window.location.origin === urlExtract[1]
            url = urlExtract[1];
        }
        url = (sameOrigin ? "" : url) || "";
        if (_connections.has(url)) {
            return _connections.get(url);
        } else {
            var connection = new WeavyConnection(url);
            _connections.set(url, connection);
            return connection;
        }
    };

    connections.remove = function (url) {
        url = url || "";
        try {
            var connection = _connections.get(url);
            if (connection && connection.destroy) {
                connection.destroy();
            }
            _connections.delete(url);
        } catch (e) {
            console.error("wvy.connection: Could not remove connection", url, e);
        }
    };

    // expose wvy.connection.default. self initiatied upon access and no other connections are active 
    Object.defineProperty(connections, "default", {
        get: function () {
            if (_connections.has("")) {
                return _connections.get("");
            } else {
                var connection = connections.get();

                $(function () {
                    setTimeout(function () {
                        if (_connections.size === 1) {
                            connection.init(wvy.authentication.default);
                        }
                    }, 1);
                });

                return connection;
            }
        }
    });

    // Bridge for simple syntax and backward compatibility with the mobile apps
    Object.defineProperty(connections, "on", {
        get: function () {
            return connections.default.on;
        }
    });

    // Bridge for simple syntax
    Object.defineProperty(connections, "invoke", {
        get: function () {
            return connections.default.invoke;
        }
    });
}));


/**
 * @external Promise
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
 */

/**
 * @external jqXHR
 * @see http://api.jquery.com/jQuery.ajax/#jqXHR
 */

/**
 * @external jqAjaxSettings
 * @see http://api.jquery.com/jquery.ajax/#jQuery-ajax-settings
 */
;
/* eslint-env commonjs, amd */

// UMD based on https://github.com/umdjs/umd/blob/master/templates/returnExports.js
// TODO: move to ES6 and transpiler

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['jquery'], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(require('jquery'));
    } else {
        // Browser globals (root is window)
        root.WeavyPromise = factory(jQuery);
    }
}(typeof self !== 'undefined' ? self : this, function ($) {
    console.debug("promise.js");

    /**
     * Module for unified promises
     * 
     * @module promise
     * @returns {WeavyPromise}
     */


    /**
     * Wrapper for jQuery $.Deferred() promise.
     * Use promise.reset() to replace the promise with a new promise.
     * 
     * @param {function} executor - Function to be executed while constructing the promise
     * @returns {external:Promise} - A function that acts as the deferred or returns the promise when called
     * */
    var WeavyPromiseWrapper = function (executor) {
        var deferred;
        var WeavyPromise = function () { return deferred.promise() };

        (WeavyPromise.reset = function () {
            deferred = $.Deferred();

            for (var vProp in deferred) {
                if (typeof deferred[vProp] === "function") {
                    WeavyPromise[vProp] = deferred[vProp].bind(deferred);
                } else {
                    WeavyPromise[vProp] = deferred[vProp];
                }
            }

            if (typeof executor === "function") {
                executor(deferred.resolve, deferred.reject);
            }
        })();


        return WeavyPromise;
    }

    /**
     * Return an instantly resolved WeavyPromise
     * @param {any} value
     */
    WeavyPromiseWrapper.resolve = function (value) {
        var promise = WeavyPromiseWrapper();
        promise.resolve(value);
        return promise;
    }

    /**
     * Return an instantly rejected WeavyPromise
     * @param {any} value
     */
    WeavyPromiseWrapper.reject = function (value) {
        var promise = WeavyPromiseWrapper();
        promise.reject(value);
        return promise;
    }

    return WeavyPromiseWrapper;
}));


/**
 * @external Promise
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
 */
;
/* eslint-env commonjs, amd */

// UMD based on https://github.com/umdjs/umd/blob/master/templates/returnExports.js
// TODO: move to ES6 and transpiler

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['jquery'], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(require('jquery'));
    } else {
        // Browser globals (root is window)
        root.WeavyUtils = factory(jQuery);
    }
}(typeof self !== 'undefined' ? self : this, function ($) {
    console.debug("utils.js");

    /**
     * Module for misc utils
     * 
     * @module utils
     * @returns {WeavyUtils}
     */

    var WeavyUtils = {};

    WeavyUtils.asArray = function (maybeArray) {
        return maybeArray && ($.isArray(maybeArray) ? maybeArray : [maybeArray]) || [];
    };

    WeavyUtils.S4 = function () {
        return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
    };

    WeavyUtils.ciEq = function (str1, str2) {
        return typeof str1 === "string" && typeof str2 === "string" && str1.toUpperCase() === str2.toUpperCase();
    };

    WeavyUtils.eqObjects = function (a, b, skipLength) {
        if (!$.isPlainObject(a) || !$.isPlainObject(b)) {
            return false;
        }

        var aProps = Object.getOwnPropertyNames(a);
        var bProps = Object.getOwnPropertyNames(b);

        if (!skipLength && aProps.length !== bProps.length) {
            return false;
        }

        for (var i = 0; i < aProps.length; i++) {
            var propName = aProps[i];

            if (a[propName] !== b[propName]) {
                return false;
            }
        }

        return true;
    };

    /**
     * Makes a replaceable returning function of a variable.
     * 
     * @example
     * var myFunc = fn("hello");
     * myFunc() // returns "hello"
     * 
     * myFunc.set("world");
     * myFunc() // returns "world"
     * 
     * @param {any} variable
     * @returns {Function}
     */
    WeavyUtils.fn = function (variable) {
        var _variable = variable;

        var returnFn = function () { return _variable };

        returnFn.set = function (variable) {
            _variable = variable;
        }

        return returnFn;
    };

    // JSON HELPERS

    /**
     * Changes a string to camelCase from PascalCase, spinal-case and snake_case
     * @param {string} name - The string to change to camel case
     * @returns {string} - The processed string as camelCase
     */
    WeavyUtils.toCamel = function (name) {
        // from PascalCase
        name = name[0].toLowerCase() + name.substring(1);

        // from snake_case and spinal-case
        return name.replace(/([-_][a-z])/ig, function ($1) {
            return $1.toUpperCase()
                .replace('-', '')
                .replace('_', '');
        });
    };

    /**
     * Changes all object keys recursively to camelCase from PascalCase, spinal-case and snake_case
     * @param {Object} obj - The object containing keys to 
     * @returns {Object} - The processed object with any camelCase keys
     */
    WeavyUtils.keysToCamel = function (obj) {
        if ($.isPlainObject(obj)) {
            const n = {};

            Object.keys(obj)
                .forEach(function (k) {
                    n[WeavyUtils.toCamel(k)] = WeavyUtils.keysToCamel(obj[k]);
                });

            return n;
        } else if ($.isArray(obj)) {
            return obj.map(function (i) {
                return WeavyUtils.keysToCamel(i);
            });
        }

        return obj;
    };

    /**
     * Stores data for the current domain in the weavy namespace.
     * 
     * @category options
     * @param {string} key - The name of the data
     * @param {data} value - Data to store
     * @param {boolean} [asJson=false] - True if the data in value should be stored as JSON
     */
    WeavyUtils.storeItem = function (key, value, asJson) {
        localStorage.setItem('weavy_' + window.location.hostname + "_" + key, asJson ? JSON.stringify(value) : value);
    };

    /**
     * Retrieves data for the current domain from the weavy namespace.
     * 
     * @category options
     * @param {string} key - The name of the data to retrieve
     * @param {boolean} [isJson=false] - True if the data shoul be decoded from JSON
     */
    WeavyUtils.retrieveItem = function (key, isJson) {
        var value = localStorage.getItem('weavy_' + window.location.hostname + "_" + key);
        if (value && isJson) {
            return JSON.parse(value)
        }

        return value;
    };

    return WeavyUtils;
}));


/**
 * @external Promise
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
 */
;
/* eslint-env commonjs, amd */

// UMD based on https://github.com/umdjs/umd/blob/master/templates/returnExports.js
// TODO: move to ES6 and transpiler

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            'jquery',
            './utils'
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(
            require('jquery'),
            require('./utils')
        );
    } else {
        // Browser globals (root is window)
        root.WeavyConsole = factory(
            jQuery,
            root.WeavyUtils
        );
    }
}(typeof self !== 'undefined' ? self : this, function ($, utils) {
    console.debug("console.js");

    // Logging functions
    var isIE = /; MSIE|Trident\//.test(navigator.userAgent);

    function colorLog(logMethod, id, color, logArguments) {
        // Binding needed for console.log.apply to work in IE
        var log = Function.prototype.bind.call(logMethod, console);

        if (isIE) {
            if (id) {
                log.apply(this, ["Weavy " + id].concat($.makeArray(logArguments)));
            } else {
                log.apply(this, $.makeArray(logArguments));
            }
        } else {
            if (id) {
                log.apply(this, ["%cWeavy %s", "color: " + color, id].concat($.makeArray(logArguments)));
            } else {
                log.apply(this, ["%cWeavy", "color: gray"].concat($.makeArray(logArguments)));
            }
        }
    }

    /**
     * Class for wrapping console logging
     * 
     * @module weavyConsole
     * @returns {WeavyConsole}
     */
    var WeavyConsole = function (id, color, enableLogging) {

        var weavyConsole = this;

        /**
        * Enable logging messages in console. Set the individual logging types to true/false or the entire property to true/false;
        *
        * @example
        * weavyConsole.logging = {
        *     log: true,
        *     debug: true,
        *     info: true,
        *     warn: true,
        *     error: true
        * };
        *
        * @example
        * weavyConsole.logging = false;
        *
        * @name logging
        * @memberof weavyConsole
        * @type {Object|boolean}
        * @property {boolean} log=true - Enable log messages in console
        * @property {boolean} debug=true - Enable debug messages in console
        * @property {boolean} info=true - Enable info messages in console
        * @property {boolean} warn=true - Enable warn messages in console
        * @property {boolean} error=true - Enable error messages in console
        */
        this.logging = enableLogging !== undefined ? enableLogging : WeavyConsole.defaults;

        /**
         * The unique id displayed by console logging.
         *
         * @category properties
         * @type {string}
         */
        this.id = id;

        /**
         * The unique instance color used by console logging.
         *
         * @category properties
         * @type {string}
         */
        this.color = color || "#" + (utils.S4() + utils.S4()).substr(-6).replace(/^([8-9a-f].).{2}/, "$100").replace(/^(.{2})[8-9a-f](.).{2}/, "$1a$200").replace(/.{2}([8-9a-f].)$/, "00$1");

        /**
         * Wrapper for `console.debug()` that adds the [instance id]{@link Weavy#getId} of weavy as prefix using the {@link Weavy#logColor}. 
         * @category logging
         * @type {console.debug}
         * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Console/debug}
         */
        this.debug = function () {
            if (weavyConsole.logging === true || weavyConsole.logging.debug) {
                colorLog(console.debug, weavyConsole.id, weavyConsole.color, arguments);
            }
        };

        /**
         * Wrapper for `console.error()` that adds the [instance id]{@link Weavy#getId} of weavy as prefix using the {@link Weavy#logColor}. 
         * @category logging
         * @type {console.error}
         * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Console/error}
         */
        this.error = function () {
            if (weavyConsole.logging === true || weavyConsole.logging.error) {
                colorLog(console.error, weavyConsole.id, weavyConsole.color, arguments);
            }
        };

        /**
         * Wrapper for `console.info()` that adds the [instance id]{@link Weavy#getId} of weavy as prefix using the {@link Weavy#logColor}. 
         * @category logging
         * @type {console.info}
         * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Console/info}
         */
        this.info = function () {
            if (weavyConsole.logging === true || weavyConsole.logging.info) {
                colorLog(console.info, weavyConsole.id, weavyConsole.color, arguments);
            }
        };

        /**
         * Wrapper for `console.log()` that adds the [instance id]{@link Weavy#getId} of weavy as prefix using the {@link Weavy#logColor}. 
         * @category logging
         * @type {console.log}
         * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Console/log}
         */
        this.log = function () {
            if (weavyConsole.logging === true || weavyConsole.logging.log) {
                colorLog(console.log, weavyConsole.id, weavyConsole.color, arguments);
            }
        };

        /**
         * Wrapper for `console.warn()` that adds the [instance id]{@link Weavy#getId} of weavy as prefix using the {@link Weavy#logColor}. 
         * @category logging
         * @type {console.warn}
         * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Console/warn}
         */
        this.warn = function () {
            if (weavyConsole.logging === true || weavyConsole.logging.warn) {
                colorLog(console.warn, weavyConsole.id, weavyConsole.color, arguments);
            }
        };

    };


    /**
     * Default class options
     * 
     * @example
     * WeavyConsole.defaults = {
     *     log: true,
     *     debug: true,
     *     info: true,
     *     warn: true,
     *     error: true
     * };
     * 
     * @name defaults
     * @memberof weavyConsole
     * @type {Object}
     * @property {boolean} log=true - Enable log messages in console
     * @property {boolean} debug=true - Enable debug messages in console
     * @property {boolean} info=true - Enable info messages in console
     * @property {boolean} warn=true - Enable warn messages in console
     * @property {boolean} error=true - Enable error messages in console
     */
    WeavyConsole.defaults = {
        log: true,
        debug: true,
        info: true,
        warn: true,
        error: true
    };

    return WeavyConsole;
}));


/**
 * @external Promise
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
 */
;
/* eslint-env commonjs, amd */

// UMD based on https://github.com/umdjs/umd/blob/master/templates/returnExports.js
// TODO: move to ES6 and transpiler

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            'jquery',
            './utils'
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(
            require('jquery'),
            require('./utils')
        );
    } else {
        // Browser globals (root is window)
        root.WeavyEvents = factory(
            jQuery,
            root.WeavyUtils
        );
    }
}(typeof self !== 'undefined' ? self : this, function ($, utils) {
    console.debug("events.js");

    var WeavyEvents = function (root) {
        /** 
         *  Reference to this instance
         *  @lends WeavyEvents#
         */
        var weavyEvents = this;

        // EVENT HANDLING
        var _events = [];

        function registerEventHandler(event, handler, context, selector, wrappingHandler) {
            _events.push(Array.from(arguments || []));
        }

        function getEventHandler(event, handler, context, selector) {
            var getHandler = Array.from(arguments || []);
            var eventHandler = _events.filter(function (eventHandler) {
                for (var i = 0; i < getHandler.length; i++) {
                    if (eventHandler[i] === getHandler[i] || utils.eqObjects(eventHandler[i], getHandler[i])) {
                        return true;
                    }
                }
                return false;
            }).pop();

            return eventHandler && (eventHandler[4] || eventHandler[0]);
        }

        function unregisterEventHandler(event, handler, context, selector) {
            var removeHandler = Array.from(arguments || []);
            _events = _events.filter(function (eventHandler) {
                for (var i = 0; i < removeHandler.length; i++) {
                    if (eventHandler[i] !== removeHandler[i] && !utils.eqObjects(eventHandler[i], removeHandler[i])) {
                        return true;
                    }
                }
                return false;
            });
        }

        /**
         * Clears all registered eventhandlers
         */
        weavyEvents.clear = function () {
            _events.forEach(function (eventHandler) {
                var events = eventHandler[0];
                var handler = eventHandler[1];
                var context = eventHandler[2];
                var selector = eventHandler[3];
                var attachedHandler = eventHandler[4];

                if (context && typeof context.off === "function") {
                    if (typeof selector === "string") {
                        context.off(events, selector, attachedHandler || handler);
                    } else {
                        context.off(events, attachedHandler || handler);
                    }
                } else {
                    console.warn("event context is missing off handler", eventHandler);
                }
            });
            _events = [];
        }

        function getEventArguments(contextRoot, eventArguments) {
            var context, events, selector, handler;

            var localEvent = typeof eventArguments[1] === "function" && eventArguments[1];
            var namespace = localEvent ? ".event.weavy" : "";

            if (localEvent) {
                // Local event
                handler = typeof eventArguments[1] === 'function' ? eventArguments[1] : eventArguments[2];
                selector = typeof eventArguments[1] === 'function' ? null : eventArguments[1];
                events = eventArguments[0];
                context = weavyEvents === contextRoot ? $(root) : $(contextRoot);
            } else {
                // Global event
                handler = typeof eventArguments[2] === 'function' ? eventArguments[2] : eventArguments[3];
                selector = typeof eventArguments[2] === 'function' ? null : eventArguments[2];
                events = eventArguments[1];
                context = eventArguments[0];
            }

            context = validateContext(context);

            // Supports multiple events separated by space
            events = localEvent ? namespaceEvents(events) : events;

            return { context: context, events: events, selector: selector, handler: handler, namespace: namespace };
        }

        function namespaceEvents(events, namespace) {
            namespace = namespace || ".event.weavy";
            return events.split(" ").map(function (eventName) { return eventName.indexOf(namespace) === -1 ? eventName + namespace : eventName; }).join(" ")
        }

        function validateContext(context) {
            return context && context.on && context || context && $(context) || (context ? $(root) : $(document))
        }


        /**
         * Registers one or several event listneres. All event listners are managed and automatically unregistered on destroy.
         * 
         * When listening to weavy events, you may also listen to `before:` and `after:` events by simply adding the prefix to a weavy event.
         * Eventhandlers listening to weavy events may return modified data that is returned to the trigger. The data is passed on to the next event in the trigger event chain. If an event handler calls event.stopPropagation() or returns false, the event chain will be stopped and the value is returned.
         *
         * @example <caption>Widget event</caption>
         * weavy.on("before:options", function(e, options) { ... })
         * weavy.on("options", function(e, options) { ... })
         * weavy.on("after:options", function(e, options) { ... })
         *  
         * @example <caption>Realtime event</caption>
         * weavy.on(weavy.connection, "eventname", function(e, message) { ... })
         *   
         * @example <caption>Connection event</caption>
         * weavy.on(weavy.connection, "disconnect.connection", function(e) { ... })
         *   
         * @example <caption>Button event</caption>
         * weavy.on(myButton, "click", function() { ... })
         *   
         * @example <caption>Multiple document listeners with custom namespace</caption>
         * weavy.on(document, ".modal", "show hide", function() { ... }, ".bs.modal")
         * 
         * @category eventhandling
         * @param {Element} [context] - Context Element. If omitted it defaults to the Weavy instance. weavy.connection and wvy.postal may also be used as contexts.
         * @param {string} events - One or several event names separated by spaces. You may provide any namespaces in the names or use the general namespace parameter instead.
         * @param {string} [selector] - Only applicable if the context is an Element. Uses the underlying jQuery.on syntax.
         * @param {function} handler - The listener. The first argument is always the event, followed by any data arguments provided by the trigger.
         * @see The underlying jQuery.on: {@link http://api.jquery.com/on/}
         */
        weavyEvents.on = function (context, events, selector, handler) {
            var argumentsArray = Array.from(arguments || []);
            var args = getEventArguments(this, argumentsArray);
            var once = argumentsArray[4];

            if (once) {
                var attachedHandler = function () {
                    var attachedArguments = Array.from(arguments || []);
                    try {
                        args.handler.apply(this, attachedArguments);
                    } catch (e) {
                        try {
                            args.handler();
                        } catch (e) {
                            console.warn("Could not invoke one handler:", e);
                        }
                    }
                    unregisterEventHandler(args.events, args.handler, args.context, args.selector);
                };

                registerEventHandler(args.events, args.handler, args.context, args.selector, attachedHandler);

                if (typeof args.selector === "string" || $.isPlainObject(args.selector)) {
                    args.context.one(args.events, args.selector, attachedHandler);
                } else {
                    args.context.one(args.events, attachedHandler);
                }
            } else {
                registerEventHandler(args.events, args.handler, args.context, args.selector);


                if (typeof args.selector === "string" || $.isPlainObject(args.selector)) {
                    args.context.on(args.events, args.selector, args.handler);
                } else {
                    args.context.on(args.events, args.handler);
                }
            }
        };

        /**
         * Registers one or several event listneres that are executed once. All event listners are managed and automatically unregistered on destroy.
         * 
         * Similar to {@link Weavy#on}.
         * 
         * @category eventhandling
         * @param {Element} [context] - Context Element. If omitted it defaults to the Weavy instance. weavy.connection and wvy.postal may also be used as contexts.
         * @param {string} events - One or several event names separated by spaces. You may provide any namespaces in the names or use the general namespace parameter instead.
         * @param {string} [selector] - Only applicable if the context is an Element. Uses the underlying jQuery.on syntax.
         * @param {function} handler - The listener. The first argument is always the event, folowed by any data arguments provided by the trigger.
         */
        weavyEvents.one = function (context, events, selector, handler) {
            weavyEvents.on.call(this, context, events, selector, handler, true);
        };

        /**
         * Unregisters event listneres. The arguments must match the arguments provided on registration using .on() or .one().
         *
         * @category eventhandling
         * @param {Element} [context] - Context Element. If omitted it defaults to the Weavy instance. weavy.connection and wvy.postal may also be used as contexts.
         * @param {string} events - One or several event names separated by spaces. You may provide any namespaces in the names or use the general namespace parameter instead.
         * @param {string} [selector] - Only applicable if the context is an Element. Uses the underlying jQuery.on syntax.
         * @param {function} handler - The listener. The first argument is always the event, folowed by any data arguments provided by the trigger.
         */
        weavyEvents.off = function (context, events, selector, handler) {
            var args = getEventArguments(this, Array.from(arguments || []));

            var offHandler = getEventHandler(args.events, args.handler, args.context, args.selector);

            unregisterEventHandler(args.events, args.handler, args.context, args.selector);

            if (offHandler) {
                if (args.context && typeof args.context.off === "function") {
                    if (typeof args.selector === "string") {
                        args.context.off(args.events, args.selector, offHandler);
                    } else {
                        args.context.off(args.events, offHandler);
                    }
                } else {
                    console.warn("event context is missing off handler", offHandler);
                }
            }
        };

        function getEventChain(currentTarget, root) {
            var eventChain = [];
            var currentLevel = currentTarget;
            while (currentLevel !== root && currentLevel.eventParent) {
                eventChain.push(currentLevel);
                currentLevel = currentLevel.eventParent;
            }
            if (currentLevel === root) {
                eventChain.push(root);
                return eventChain;
            } else {
                // No complete chain, return root only
                // Would it be better to return currentTarget instead of root?
                return [root];
            }
        }

        /**
         * Trigger a custom event. Events are per default triggered on the weavy instance using the weavy namespace.
         * 
         * The trigger has an event chain that adds `before:` and `after:` events automatically for all events except when any custom `prefix:` is specified. This way you may customize the eventchain by specifying `before:`, `on:` and `after:` in your event name to fire them one at the time. The `on:` prefix will then be removed from the name when the event is fired.
         * 
         * Eventhandlers listening to the event may return modified data that is returned by the trigger event. The data is passed on to the next event in the trigger event chain. If an event handler calls `event.stopPropagation()` or `return false`, the event chain will be stopped and the value is returned.
         * 
         * @example
         * 
         * // Normal triggering
         * weavy.triggerEvent("myevent");
         * 
         * // Will trigger the following events on the weavy instance
         * // 1. `before:myevent.event.weavy`
         * // 2. `myevent.event.weavy`
         * // 3. `after:myevent.event.weavy`
         * 
         * // Custom triggering, one at the time
         * weavy.triggerEvent("before:myevent");
         * weavy.triggerEvent("on:myevent");
         * weavy.triggerEvent("after:myevent");
         * 
         * @category eventhandling
         * @param {any} name - The name of the event.
         * @param {(Array/Object/JSON)} [data] - Data may be an array or plain object with data or a JSON encoded string. Unlike jQuery, an array of data will be passed as an array and _not_ as multiple arguments.
         * @param {Event} [originalEvent] - When relaying another event, you may pass the original Event to access it in handlers.
         * @returns {data} The data passed to the event trigger including any modifications by event handlers.
         */
        weavyEvents.triggerEvent = function (name, data, originalEvent) {
            var hasPrefix = name.indexOf(":") !== -1;
            var prefix = name.split(":")[0];
            var namespace = ".event.weavy";
            var eventChain = getEventChain(this, root);
            var eventChainReverse = eventChain.slice().reverse();

            name = name.replace("on:", "") + namespace;

            // Triggers additional before:* and after:* events
            var beforeEvent = $.Event("before:" + name);
            var event = $.Event(name);
            var afterEvent = $.Event("after:" + name);

            if (originalEvent) {
                beforeEvent.originalEvent = originalEvent;
                event.originalEvent = originalEvent;
                afterEvent.originalEvent = originalEvent;
            }

            if (data && !$.isArray(data) && !$.isPlainObject(data)) {
                try {
                    data = JSON.parse(data);
                } catch (e) {
                    root.warn("Could not parse event data");
                }
            }

            root.debug("trigger", name);
            var result, currentTarget, ct;

            // Wrap arrays in an array to avoid arrays converted to multiple arguments by jQuery
            if (hasPrefix) {
                // Defined prefix. before: on: after: custom:
                // select direction of eventChain
                var singleEventChain = (prefix === "before" || prefix === "after") ? eventChainReverse : eventChain;

                for (ct = 0; ct < singleEventChain.length; ct++) {
                    currentTarget = singleEventChain[ct];
                    result = $(currentTarget).triggerHandler(event, $.isArray(data) ? [data] : data);
                    data = (result || result === false) ? result : data;
                    if (data === false || event.isPropagationStopped()) { return data; }
                }
            } else {
                // Before
                // eventChain from root
                for (ct = 0; ct < eventChainReverse.length; ct++) {
                    currentTarget = eventChainReverse[ct];
                    result = $(currentTarget).triggerHandler(beforeEvent, $.isArray(data) ? [data] : data);
                    data = (result || result === false) ? result : data;
                    if (data === false || beforeEvent.isPropagationStopped()) { return data; }
                }

                // On
                // eventChain from target
                for (ct = 0; ct < eventChain.length; ct++) {
                    currentTarget = eventChain[ct];
                    result = $(currentTarget).triggerHandler(event, $.isArray(data) ? [data] : data);
                    data = (result || result === false) ? result : data;
                    if (data === false || event.isPropagationStopped()) { return data; }
                }

                // After
                // eventChain from root
                for (ct = 0; ct < eventChainReverse.length; ct++) {
                    currentTarget = eventChainReverse[ct];
                    result = $(currentTarget).triggerHandler(afterEvent, $.isArray(data) ? [data] : data);
                    data = (result || result === false) ? result : data;
                }
            }

            return beforeEvent.isDefaultPrevented() || event.isDefaultPrevented() || afterEvent.isDefaultPrevented() ? false : data;
        };

    };

    return WeavyEvents;
}));


/**
 * @external Promise
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
 */

/**
 * @external jqXHR
 * @see http://api.jquery.com/jQuery.ajax/#jqXHR
 */

/**
 * @external jqAjaxSettings
 * @see http://api.jquery.com/jquery.ajax/#jQuery-ajax-settings
 */
;
/* eslint-env commonjs, amd */

// UMD based on https://github.com/umdjs/umd/blob/master/templates/returnExports.js
// TODO: move to ES6 and transpiler

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            'jquery',
            './promise'
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(
            require('jquery'),
            require('./promise')
        );
    } else {
        // Browser globals (root is window)
        root.WeavyPanels = factory(jQuery, root.WeavyPromise);
    }
}(typeof self !== 'undefined' ? self : this, function ($, WeavyPromise) {
    console.debug("panels.js");

    var WeavyPanels = function (weavy) {

        var _panelsContainers = new Map();
        var _panels = new Map();
        var loadingTimeout = [];

        var _whenClosed = WeavyPromise.resolve();

        function createPanelsContainer(containerId) {
            containerId = containerId || "global";
            var containerElementId = weavy.getId("panels-" + containerId);
            var panels = document.createElement("div");
            panels.id = containerElementId;
            panels.className = "weavy-panels";
            panels.addPanel = addPanel.bind(panels);
            //panels.preload = preloadPanels.bind(panels);

            panels.dataset.containerId = containerId;

            // Events
            panels.on = weavy.events.on.bind(panels);
            panels.one = weavy.events.one.bind(panels);
            panels.off = weavy.events.off.bind(panels);
            panels.triggerEvent = weavy.events.triggerEvent.bind(panels);

            _panelsContainers.set(containerId, panels);
            return panels;
        }


        /**
         * Create a panel that has frame handling. If the panel already exists it will return the existing panel.
         * 
         * @param {string} panelId - The id of the panel.
         * @param {url} [url] - Optional url. The page will not be loaded until {@link panels#preloadFrame} or {@link Weavy#open} is called.
         * @param {Object} [attributes] - All panel attributes are optional
         * @param {string} attributes.type - Type added as data-type attribute.
         * @param {boolean} attributes.persistent - Should the panel remain when {@link panels#removePanel} or {@link panels#clearPanels} are called?
         * @returns {Element}
         * @emits panels#event:panel-added
         */
        function addPanel(panelId, url, attributes) {
            if (!panelId) {
                weavy.error("WeavyPanels.addPanel() is missing panelId");
                return;
            }

            weavy.debug("creating panel", panelId);

            if (!(this instanceof HTMLElement)) {
                weavy.warn("addPanel: No valid panel root defined for " + panelId);
                return Promise.reject();
            }

            var panelsRoot = this;

            var panelElementId = weavy.getId("panel-" + panelId);
            var domPanel = panelsRoot && panelsRoot.querySelector("#" + panelElementId);
            var pendingPanel = Array.isArray(this._addPanels) && this._addPanels.filter(function (panel) { return panel.id === panelElementId; }).pop();

            if (domPanel || pendingPanel) {
                weavy.warn("WeavyPanels.addPanel(" + panelId + ") is already created");
                return domPanel || pendingPanel;
            }

            if (!$.isPlainObject(attributes)) {
                attributes = {};
            }

            // panel
            var panel = document.createElement("div");
            panel.className = "weavy-panel";
            panel.id = panelElementId;
            panel.panelId = panelId;
            panel.dataset.id = panelId;

            // frame
            var frame = document.createElement("iframe");
            frame.className = "weavy-panel-frame";
            frame.id = weavy.getId("panel-frame-" + panelId);
            frame.name = weavy.getId("panel-frame-" + panelId);
            frame.allowFullscreen = 1;

            frame.dataset.weavyId = weavy.getId();

            // Events
            panel.eventParent = panelsRoot;
            panel.on = weavy.events.on.bind(panel);
            panel.one = weavy.events.one.bind(panel);
            panel.off = weavy.events.off.bind(panel);
            panel.triggerEvent = weavy.events.triggerEvent.bind(panel);

            if (url) {
                frame.dataset.src = weavy.httpsUrl(url, weavy.options.url);
            }

            if (attributes.type) {
                frame.dataset.type = attributes.type;
                panel.dataset.type = attributes.type;
            }

            if (attributes.persistent !== undefined) {
                panel.dataset.persistent = String(attributes.persistent);
            }

            if (attributes.preload !== undefined) {
                panel.dataset.preload = String(attributes.preload);
            }

            panel.appendChild(frame);

            if (panelsRoot) {
                weavy.debug("Appending panel", panelId)
                panelsRoot.appendChild(panel);
                _panels.set(panelId, panel);
            } else {
                weavy.error("Could not append panel", panelId)
            }

            panel.open = openPanel.bind(panelsRoot, panelId);
            panel.toggle = togglePanel.bind(panelsRoot, panelId);
            panel.close = closePanel.bind(panelsRoot, panelId);
            panel.load = loadPanel.bind(panelsRoot, panelId);
            panel.preload = preloadPanel.bind(panelsRoot, panelId);
            panel.reload = reloadPanel.bind(panelsRoot, panelId);
            panel.reset = resetPanel.bind(panelsRoot, panelId);
            panel.postMessage = postMessage.bind(panelsRoot, panelId);
            panel.remove = removePanel.bind(panelsRoot, panelId);

            // Promises

            panel.whenReady = new WeavyPromise();
            weavy.on(wvy.postal, "ready", { weavyId: weavy.getId(), windowName: frame.name }, function () {
                panel.whenReady.resolve({ panelId: panelId, windowName: frame.name });
            });

            panel.whenLoaded = new WeavyPromise();
            weavy.on(wvy.postal, "load", { weavyId: weavy.getId(), windowName: frame.name }, function () {
                panel.whenLoaded.resolve({ panelId: panelId, windowName: frame.name });
            });

            // States

            Object.defineProperty(panel, "isOpen", {
                get: function () { return panel.classList.contains("weavy-open"); }
            });

            Object.defineProperty(panel, "isLoading", {
                get: panelIsLoading.bind(weavy, panelId),
                set: function (isLoading) {
                    /// start or stop navigation loading indication
                    setPanelLoading(panelId, isLoading);
                }
            });

            Object.defineProperty(panel, "isLoaded", {
                get: panelIsLoaded.bind(weavy, panelId),
                set: function (isLoaded) {
                    if (isLoaded) {
                        // stop loading indication
                        setPanelLoading(panelId, false);
                    } else {
                        // start full loading indication
                        setPanelLoading(panelId, true, true);
                    }
                }
            });


            // External controls

            panel.appendChild(renderControls.call(weavy, panel, attributes));

            /**
             * Triggered when a panel is added
             * 
             * @event panels#panel-added
             * @category events
             * @returns {Object}
             * @property {Element} panel - The created panel
             * @property {string} panelId - The id of the panel
             * @property {url} url - The url for the frame.
             * @property {Object} attributes - Panel attributes
             * @property {string} attributes.type - Type of the panel.
             * @property {boolean} attributes.persistent - Will the panel remain when {@link panels#removePanel} or {@link panels#clearPanels} are called?
             */
            panelsRoot.triggerEvent("panel-added", { panel: panel, panelId: panelId, url: url, attributes: attributes });

            return panel;
        }

        function registerLoading(panelId) {
            var frame = $(_panels.get(panelId)).find("iframe").get(0);
            if (frame && !frame.registered) {

                try {
                    wvy.postal.registerContentWindow(frame.contentWindow, frame.name, weavy.getId());
                } catch (e) {
                    weavy.error("Could not register window id", frame.name, e);
                }

                var onready = function (e) {
                    weavy.debug("panel ready", panelId);
                    setPanelLoading.call(weavy, panelId, false);
                    delete frame.dataset.src;
                    frame.loaded = true;
                };
                weavy.on(wvy.postal, "ready", { weavyId: weavy.getId(), windowName: frame.name }, onready);
                frame.registered = true;
            }
        }

        /**
         * Check if a panel is currently loading.
         * 
         * @category panels
         * @param {string} panelId - The id of the panel to check.
         * @returns {boolean} True if the panel curerently is loading
         */
        function panelIsLoading(panelId) {
            var frame = $(_panels.get(panelId)).find("iframe").get(0);
            return frame.getAttribute("src") && !frame.loaded ? true : false;
        }

        /**
         * Check if a panel has finished loading.
         * 
         * @category panels
         * @param {string} panelId - The id of the panel to check.
         * @returns {boolean} True if the panel has finished loading.
         */
        function panelIsLoaded(panelId) {
            var frame = $(_panels.get(panelId)).find("iframe").get(0);
            return frame.loaded ? true : false;
        }

        /**
         * Set the loading indicator on the specified panel. The loading indicatior is automatically removed on loading. It also makes sure the panel is registered and sets up frame communication when loaded.
         * 
         * @category panels
         * @param {string} panelId - The id of the panel that is loading.
         * @param {boolean} isLoading - Sets whether the panel is loading or not.
         * @param {boolean} [fillBackground] - Sets an opaque background that hides any panel content during loading.
         * @emits Weavy#panel-loading
         */
        function setPanelLoading(panelId, isLoading, fillBackground) {
            if (isLoading) {
                registerLoading(panelId);
                loadingTimeout[panelId] = weavy.timeout(15000);
                loadingTimeout[panelId].then(setPanelLoading.bind(weavy, panelId, false));
            } else {
                if (loadingTimeout[panelId]) {
                    loadingTimeout[panelId].reject();
                    delete loadingTimeout[panelId];
                }
            }

            var panel = _panels.get(panelId);

            /**
             * Event triggered when panel is starting to load or stops loading.
             * 
             * @category events
             * @event Weavy#panel-loading
             * @returns {Object}
             * @property {string} panelId - The id of the panel loading.
             * @property {boolean} isLoading - Indicating wheter the panel is loading or not.
             * @property {boolean} fillBackground - True if the panel has an opaque background during loading.
             */
            panel.triggerEvent("panel-loading", { panelId: panelId, isLoading: isLoading, fillBackground: fillBackground });
        }

        /**
         * Tells a panel that it need to reload it's content.
         * 
         * @category panels
         * @param {string} panelId - The id of the panel to refresh.
         * @emits Weavy#refresh
         */
        function reloadPanel(panelId) {
            return weavy.whenReady().then(function () {
                setPanelLoading.call(weavy, panelId, true);

                var panel = _panels.get(panelId);

                panel.postMessage({ "name": "reload" })

                /**
                 * Event triggered when a panel is resfreshed and needs to reload it's content.
                 * 
                 * @category events
                 * @event Weavy#refresh
                 * @returns {Object}
                 * @property {string} panelId - The id of the panel being refreshed.
                 */
                panel.triggerEvent("panel-reload", { panelId: panelId });
            });
        }

        /**
         * Loads an url in a frame or sends data into a specific frame. Will replace anything in the frame.
         * 
         * @ignore
         * @category panels
         * @param {HTMLIFrameElement} frame - The frame element
         * @param {any} url - URL to load.
         * @param {any} [data] - URL/form encoded data.
         * @param {any} [method=GET] - HTTP Request Method {@link https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods}
         * @returns {external:Promise}
         */
        function sendToFrame (frame, url, data, method) {
            // Todo: return complete promise instead
            return weavy.whenReady().then(function () {
                method = String(method || "get").toLowerCase();

                // Ensure target exists
                //var frame = $("iframe[name='" + frameName + "']", weavy.nodes.container).get(0);

                weavy.log("sendToFrame", frame, url);
                if (frame) {
                    var frameUrl = url;
                    if (method === "get") {
                        if (data) {
                            // Append data to URL
                            if (frameUrl.indexOf('?') === -1) {
                                frameUrl = frameUrl + "?" + data;
                            } else {
                                frameUrl = frameUrl + "&" + data;
                            }
                        }
                    }


                    if (frame.src !== frameUrl) {
                        // If no url is set yet, set an url
                        frame.src = frameUrl;
                        if (method === "get") {
                            weavy.info("sendToFrame using src");
                            // No need to send a form since data is appended to the url
                            return;
                        }
                    } else if (frame.src && method === "get") {
                        weavy.info("sendToFrame using window.open");
                        window.open(frameUrl, frame.name);
                        return;
                    }

                    weavy.info("sendToFrame using form");

                    // Create a form to send to the frame
                    var $form = $("<form>", {
                        action: url,
                        method: method,
                        target: frame.name
                    });

                    if (data) {
                        data = data.replace(/\+/g, '%20');
                    }
                    var dataArray = data && data.split("&") || [];

                    // Add all data as hidden fields
                    $form.append(dataArray.map(function (pair) {
                        var nameValue = pair.split("=");
                        var name = decodeURIComponent(nameValue[0]);
                        var value = decodeURIComponent(nameValue[1]);
                        // Find one or more fields
                        return $('<input>', {
                            type: 'hidden',
                            name: name,
                            value: value
                        });
                    }));

                    // Send the form and forget it
                    $form.appendTo(weavy.nodes.container).submit().remove();
                }
            });
        }


        /**
         * Load an url with data directly in a specific panel. Uses turbolinks forms if the panel is loaded and a form post to the frame if the panel isn't loaded.
         * 
         * @category panels
         * @param {string} panelId - The id of the panel to load in.
         * @param {string} [url] - The url to load in the panel.
         * @param {any} [data] -  URL/form-encoded data to send
         * @param {any} [method=GET] - HTTP Request Method {@link https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods}
         * @param {bool} [replace] - Replace the content in the panel and load it fresh.
         * @returns {external:Promise}
         */
        function loadPanel(panelId, url, data, method, replace) {
            return weavy.whenReady().then(function () {
                var panel = _panels.get(panelId);

                if (panel) {
                    var frameTarget = $(panel).find("iframe").get(0);

                    if (url) {
                        url = weavy.httpsUrl(url, weavy.options.url);

                        if (replace || !panel.isLoaded) {
                            // Not yet fully loaded
                            setPanelLoading(panelId, true, replace);
                            sendToFrame(frameTarget, url, data, method);
                        } else {
                            // Fully loaded, send using turbolinks
                            panel.postMessage({ name: 'turbolinks-visit', url: url, data: data, method: method });
                        }

                    } else if (!panel.isLoaded && !panel.isLoading) {
                        // start predefined loading
                        $(frameTarget).attr("src", frameTarget.dataset.src);
                        setPanelLoading.call(this, panelId, true);
                    } else if (panel.isLoaded || panel.isLoading) {
                        // already loaded
                        panel.postMessage({ name: 'show' });
                    } else {
                        // No src defined
                        return Promise.resolve();
                    }

                    return panel.whenLoaded();
                } else {
                    weavy.warn("loadPanel: Panel not found " + panelId);
                    return Promise.reject({ panelId: panelId, url: url, data: data, method: method, replace: replace });
                }
            });
        }

        /**
         * Open a specific panel. The open waits for the [weavy.whenReady]{@link Weavy#whenReady} to complete, then opens the panel.
         * Adds the `weavy-open` class to the {@link Weavy#nodes#container}.
         * 
         * @category panels
         * @param {string} panelId - The id of the panel to open.
         * @param {string} [destination] - Tells the panel to navigate to a specified url.
         * @emits Weavy#open
         * @returns {external:Promise}
         */
        function openPanel(panelId, destination) {

            if (!(this instanceof HTMLElement)) {
                weavy.warn("openPanel: No valid panel root defined for " + panelId);
                return Promise.reject({ panelId: panelId, destination: destination });
            }

            var panelsRoot = this;

            return weavy.whenReady().then(function () {
                weavy.info("openPanel", panelId + (destination ? " " + destination : ""));

                var panel = _panels.get(panelId);

                if (!panel) {
                    weavy.warn("openPanel: Panel not found " + panelId);
                    return Promise.reject({ panelId: panelId, destination: destination });
                }

                if (!panel.dataset.persistent && !weavy.authentication.isAuthorized()) {
                    weavy.warn("Unauthorized, can't open panel " + panelId);
                    return Promise.reject({ panelId: panelId, destination: destination });
                }

                $(panel).addClass("weavy-open");

                /**
                 * Event triggered when a panel is opened.
                 * 
                 * @category events
                 * @event Weavy#open
                 * @returns {Object}
                 * @property {string} panelId - The id of the panel being openened.
                 * @property {string} [destination] - Any url being requested to open in the panel.
                 */
                var openResult = panel.triggerEvent("panel-open", { panelId: panelId, destination: destination, panels: panelsRoot });

                if (openResult !== false && openResult.panelId === panelId) {
                    return loadPanel(panelId, destination);
                } else {
                    return Promise.reject({ panelId: panelId, destination: destination, panels: panelsRoot });
                }
            });
        }

        /**
         * Closes all panels and removes the `weavy-open` class from the {@link Weavy#nodes#container}. Sets the {@link Weavy#whenClosed} Promise if not already closing.
         * 
         * @category panels
         * @param {string} [panelId] - The id of any specific panel to close. If that panel is open, the panel will be closed, otherwise no panel will be closed.
         * @returns {external:Promise} {@link Weavy#whenClosed}
         * @emits Weavy#close
         */
        function closePanel(panelId, silent) {

            if (!(this instanceof HTMLElement)) {
                weavy.warn("closePanel: No valid panel root defined for " + panelId);
                return Promise.reject({ panelId: panelId });
            }

            var panelsRoot = this;

            return weavy.whenReady().then(function () {
                var panel = _panels.get(panelId);

                if (!panel) {
                    weavy.warn("closePanel: Panel not found " + panelId);
                    return Promise.reject({ panelId: panelId });
                }

                if (panel.isOpen) {
                    weavy.info("closePanel", panelId, silent === true ? "(silent)" : "");

                    $(panel).removeClass("weavy-open");

                    if (silent !== true) {
                        /**
                         * Event triggered when weavy closes all panels. Wait for the {@link Weavy#whenClosed} Promise to do additional things when weavy has finished closing.
                         * 
                         * @category events
                         * @event Weavy#close
                         */
                        panel.triggerEvent("panel-close", { panelId: panelId, panels: panelsRoot });
                    }

                    panel.postMessage({ name: 'hide' });

                    // Return timeout promise
                    _whenClosed = weavy.timeout(250);
                } 

                return _whenClosed();
            });
        }

        /**
         * [Open]{@link Weavy#open} or [close]{@link Weavy#close} a specific panel.
         * 
         * @category panels
         * @param {string} panelId - The id of the panel toggled.
         * @param {string} [destination] - Tells the panel to navigate to a specified url when opened.
         * @emits Weavy#toggle
         */
        function togglePanel(panelId, destination) {

            if (!(this instanceof HTMLElement)) {
                weavy.warn("togglePanel: No valid panel root defined for " + panelId);
                return Promise.reject({ panelId: panelId, destination: destination });
            }

            return weavy.whenReady().then(function () {
                weavy.info("toggling panel", panelId);

                var panel = _panels.get(panelId);

                if (!panel) {
                    weavy.warn("togglePanel: Panel not found " + panelId);
                    return Promise.reject({ panelId: panelId, destination: destination });
                }

                var shouldClose = panel.isOpen;

                /**
                    * Event triggered when a panel is toggled open or closed.
                    * 
                    * @category events
                    * @event Weavy#toggle
                    * @returns {Object}
                    * @property {string} panelId - The id of the panel toggled.
                    * @property {boolean} closed - True if the panel is closed.
                    */
                panel.triggerEvent("panel-toggle", { panelId: panelId, closed: shouldClose });

                if (shouldClose) {
                    return panel.close();
                } else {
                    return panel.open(typeof (destination) === "string" ? destination : null);
                }
            });
        }

        /**
         * Sends a postMessage to a panel iframe
         * 
         * @category panels
         * @param {string} panelId - If the frame is a panel, the panelId may also be provided.
         * @param {object} message - The Message to send
         * @param {Transferable[]} [transfer] - A sequence of Transferable objects that are transferred with the message.
         * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage}
         */
        function postMessage(panelId, message, transfer) {
            return weavy.whenReady().then(function () {
                var frameTarget = $(_panels.get(panelId)).find("iframe").get(0);
                if (frameTarget) {
                    try {
                        wvy.postal.postToFrame(frameTarget.name, weavy.getId(), message, transfer);
                    } catch (e) {
                        weavy.error("Could not post panel message", e);
                    }
                }
            });
        }

        /** 
         * Resets a panel to its original url. This can be used if the panel has ended up in an incorrect state.
         * 
         * @category panels
         * @param {string} panelId - The id of the panel to reset.
         */
        function resetPanel(panelId) {
            return weavy.whenReady().then(function () {
                var panel = _panels.get(panelId);
                if (panel) {
                    weavy.log("resetting panel", panelId)

                    var frame = panel.querySelector("iframe");
                    var isOpen = panel.isOpen;

                    var frameSrc = frame.src || frame.dataset.src;
                    var frameType = frame.getAttribute('data-type');

                    // frame
                    var newFrame = document.createElement("iframe");
                    newFrame.className = "weavy-panel-frame";
                    newFrame.id = weavy.getId("weavy-panel-frame-" + panelId);
                    newFrame.name = weavy.getId("weavy-panel-frame-" + panelId);
                    newFrame.allowFullscreen = 1;
                    newFrame.dataset.src = frameSrc;
                    newFrame.setAttribute("data-type", frameType);

                    panel.removeChild(frame);
                    panel.appendChild(newFrame);

                    if (isOpen) {
                        loadPanel(panelId, frameSrc, null, null, true)
                    }
                }
            });
        }

        /**
         * Removes a panel. If the panel is open it will be closed before it's removed.
         * 
         * @param {string} panelId - The id of the panel to remove
         * @param {boolean} [force] - True will remove the panel even if it's persistent
         * @emits panels#panel-removed
         */
        function removePanel(panelId, force) {
            if (!(this instanceof HTMLElement)) {
                weavy.warn("removePanel: No valid panel root defined for " + panelId);
                return Promise.reject();
            }

            var panelsRoot = this;

            var _removePanel = function () {
                var panel = _panels.get(panelId);

                if (panel) {
                    var $panel = $(panel);
                    if (!$panel.data("persistent") || force) {
                        if (panel.isOpen) {
                            $panel[0].id = weavy.getId("weavy-panel-removed-" + panelId);
                            return weavy.timeout(0).then(function () {
                                return panel.close().then(function () {
                                    return removePanel.call(panelsRoot, panelId, force);
                                });
                            });
                        } else {
                            $panel.remove();
                            _panels.delete(panelId);

                            /**
                             * Triggered when a panel has been removed.
                             * 
                             * @event panels#panel-removed
                             * @category events
                             * @returns {Object}
                             * @property {string} panelId - Id of the removed panel
                             */
                            panelsRoot.triggerEvent("panel-removed", { panelId: panelId });

                            return Promise.resolve();
                        }
                    }
                }

                return Promise.reject(new Error("removePanel(): Panel " + panelId + " not found"));
            };

            return force ? _removePanel() : weavy.whenReady().then(_removePanel);
        }

        /**
         * Closes all panels except persistent panels.
         */
        function closePanels() {
            weavy.debug("closing panels")
            _panels.forEach(function (panel) {
                panel.close();
            });
        }

        /**
         * Removes all panels except persistent panels.
         * @param {boolean} force - Forces all panels to be removed including persistent panels
         */
        function clearPanels(force) {
            weavy.debug("clearing" + (force ? " all" : "") + " panels")
            _panels.forEach(function (panel) {
                panel.remove(force);
            });
        }

        /**
         * Resets all panels to initial state.
         */
        function resetPanels() {
            weavy.debug("resetting panels")

            _panels.forEach(function (panel) {
                panel.reset();
            });
        }

        /**
         * Create panel controls for expand/collapse and close. Set control settings in {@link panels.defaults|options}
         * 
         * @returns {Element} 
         */
        function renderControls(panel, options) {

            var controls = document.createElement("div");
            controls.className = "weavy-controls";

            if (options.controls) {
                if (options.controls === true || options.controls.close) {
                    var close = document.createElement("div");
                    close.className = "weavy-icon";
                    close.title = "Close";
                    close.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" /></svg>';
                    weavy.on(close, "click", panel.close.bind(panel));
                    controls.appendChild(close);
                }
            }

            return controls;
        }

        /**
         * Preload a frame. The frame needs to have data-src attribute set instead of src attribute. 
         * Panels created using {@link panels#addPanel} have the appropriate settings for preload.
         * If the frame belongs to a panel it will triggger loading animations.
         * 
         * @param {string} panelId - The frame that should be preloaded.
         * @returns {external:Promise} [callback] - Function called when the frame has loaded
         */
        function preloadPanel(panelId) {
            weavy.debug("preloading panel:", panelId);
            var panel = _panels.get(panelId);

            var delayedFrameLoad = function () {
                if (!panel.isLoading && !panel.isLoaded) {
                    panel.load();
                }
            };

            // Wait for idle
            if (window.requestIdleCallback) {
                window.requestIdleCallback(delayedFrameLoad);
            } else {
                if (document.readyState === "complete") {
                    delayedFrameLoad();
                } else {
                    $(document).one("load", delayedFrameLoad);
                }
            }

            return panel.whenLoaded();
        }

        /**
         * Preload all frames. Frames will be loaded sequentially starting with system frames. 
         * Preloading is ignored on mobile devices.
         * @param {boolean} [force] - Force preloading for all frames, otherwise only system frames will be preloaded.
         */
        function preloadPanels(force) {
            if (weavy.options.isMobile) {
                return Promise.reject();
            }

            var preloadRoot = this;

            return weavy.whenLoaded().then(function () {
                var panels;

                if (preloadRoot instanceof HTMLElement && preloadRoot.dataset.containerId) {
                    panels = _panelsContainers.get(preloadRoot.dataset.containerId).panels;
                } else {
                    panels = Array.from(_panels.values());
                }

                var currentlyLoadingFrames = panels.filter(function (panel) { return panel.isLoading; });
                if (currentlyLoadingFrames.length) {
                    // Wait until user loaded frames has loaded
                    weavy.debug("preload waiting for " + currentlyLoadingFrames.length + " panels");
                    return Promise.all(currentlyLoadingFrames.map(function (panel) { return panel.whenLoaded() })).then(function () { return preloadPanels.call(preloadRoot, force); });
                }

                var unloadedPanels = panels.filter(function (panel) { return panel.dataset.preload === "true" && !panel.isLoading && !panel.isLoaded });
                if (unloadedPanels.length) {
                    // Preload all panels with 'preload: true'
                    return Promise.all(unloadedPanels.map(function (panel) { return panel.preload() })).then(function () { return preloadPanels.call(preloadRoot, force) });
                } else if (force) {
                    // Preload any other panels except 'preload: false'
                    var remainingPanels = panels.filter(function (panel) { return panel.dataset.preload !== "false" && !panel.isLoading && !panel.isLoaded });
                    if (remainingPanels.length) {
                        return remainingPanels[0].preload().then(function () {
                            return weavy.timeout(1500).then(function () {
                                //preload next after delay
                                return preloadPanels.call(preloadRoot, true);
                            });
                        });
                    }
                }

                weavy.debug("preload done");
                return Promise.resolve();
            });
        }

        weavy.on("panel-loading", function (e, panelLoading) {
            var $panel = $(_panels.get(panelLoading.panelId));

            if (panelLoading.isLoading) {
                $panel.addClass(panelLoading.fillBackground ? "weavy-loading weavy-loading-fill" : "weavy-loading");
            } else {
                $panel.removeClass("weavy-loading weavy-loading-fill");
            }
        });

        weavy.on("clear-user signed-out", closePanels);
        weavy.on("after:clear-user after:signed-out", resetPanels);
        weavy.on("user-error", function () {
            clearPanels()
        });
        weavy.on("destroy", clearPanels.bind(this, true));
        weavy.on("load", function () {
            if (weavy.options.preload !== false) {
                weavy.timeout(5000).then(preloadPanels)
            }
        });

        // Exports
        return {
            clearPanels: clearPanels,
            closePanels: closePanels,
            createContainer: createPanelsContainer,
            getContainer: function (containerId) {
                return _panelsContainers.get(containerId || "global");
            },
            getPanel: function (panelId) {
                return _panels.get(panelId);
            },
            preload: preloadPanels,
            resetPanels: resetPanels
        }
    };

    /**
     * Default panels options
     * 
     * @example
     * WeavyPanels.defaults = {
     *     controls: {
     *         close: true
     *     }
     * };
     *
     * @name defaults
     * @memberof panels
     * @type {Object}
     * @property {Object} controls - Set to `false` to disable control buttons
     * @property {boolean} controls.close - Render a close panel control button.
     */
    WeavyPanels.defaults = {
        controls: {
            close: false
        }
    };

    return WeavyPanels;

}));

/* eslint-env commonjs, amd */

// UMD based on https://github.com/umdjs/umd/blob/master/templates/returnExports.js
// TODO: move to ES6 and transpiler

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            'jquery',
            './panels',
            './utils',
            './promise'
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(
            require('jquery'),
            require('./panels'),
            require('./utils'),
            require('./promise')
        );
    } else {
        // Browser globals (root is window)
        root.WeavyApp = factory(jQuery, root.WeavyPanels, root.WeavyUtils, root.WeavyPromise);
    }
}(typeof self !== 'undefined' ? self : this, function ($, WeavyPanels, utils, WeavyPromise) {
    console.debug("app.js");

    var WeavyApp = function (weavy, space, options, data) {

        weavy.log("new WeavyApp", options);

        /** 
         *  Reference to this instance
         *  @lends WeavyApp#
         */
        var app = this;

        this.container = null;
        this.root = null;
        this.panel = null;
        this.url = null;

        this.id = null;
        this.name = null;
        this.key = null;
        this.guid = null;
        this.type = null;
        this.typeName = null;

        this.autoOpen = null;

        this.weavy = weavy;
        this.space = space;
        this.options = options;
        this.data = data;

        // Event handlers
        this.eventParent = space;
        this.on = weavy.events.on.bind(app);
        this.one = weavy.events.one.bind(app);
        this.off = weavy.events.off.bind(app);
        this.triggerEvent = weavy.events.triggerEvent.bind(app);

        Object.defineProperty(this, "isOpen", {
            get: function () {
                weavy.log("isOpen", app.panel, app.panel && app.panel.isOpen);
                return app.panel ? app.panel.isOpen : false;
            }
        });

        this.isLoaded = false;
        this.isBuilt = false;

        this.whenLoaded = new WeavyPromise();
        this.whenBuilt = new WeavyPromise();

        this.configure = function (options, data) {
            if (options && typeof options === "object") {
                app.options = app.weavy.extendDefaults(app.options, options, true);
            }

            if (data && typeof data === "object") {
                app.data = data;
            }

            if (app.options && typeof app.options === "object") {
                if (app.autoOpen === null || app.container === null) {
                    app.autoOpen = app.options && app.options.open !== undefined ? app.options.open : (space && space.options && space.options.open !== undefined ? space.options.open : (space && !space.tabbed || false));
                    app.container = app.options.container;
                }

                if (app.id === null && app.options.id) {
                    app.id = app.options.id;
                }

                if (app.key === null && app.options.key) {
                    app.key = app.options.key;
                }

                if (app.name === null && app.options.name) {
                    app.name = app.options.name;
                }

                if (app.type === null && app.options.type) {
                    app.type = app.options.type;
                }
            }

            if (app.data && typeof app.data === "object") {
                app.id = app.data.id;
                app.name = app.data.name;
                app.typeName = app.data.typeName;
                app.guid = app.data.guid;

                app.url = app.data.url;

                // Check if app.data needs to be added in space.data.apps
                if (app.space.data && app.space.data.apps) {
                    var dataApps = utils.asArray(app.space.data.apps);

                    var foundAppData = dataApps.filter(function (appData) { return app.match(appData) }).pop();
                    if (!foundAppData) {
                        // Add to space data
                        app.space.data.apps.push(app.data);
                    }
                }

                app.isLoaded = true;
                app.whenLoaded.resolve(app.data);

                if (!app.isBuilt && app.weavy.isLoaded) {
                    app.build();
                }
            }
        }

        this.fetchOrCreate = function (options, refresh) {

            if (options && typeof options === "object") {
                app.options = options;
            }

            if (app.options && typeof app.options === "object") {

                var initAppUrl = weavy.httpsUrl("/client/app", weavy.options.url);

                var optionsWithSpace = weavy.extendDefaults({ space: space.id || space.key }, app.options);

                weavy.ajax(initAppUrl, optionsWithSpace, "POST").then(function (data) {
                        app.data = data;
                        app.configure.call(app);
                    }).catch(function (xhr, status, error) {
                        app.weavy.error("WeavyApp.fetchOrCreate()", xhr.responseJSON && xhr.responseJSON.message || xhr);
                        app.whenLoaded.reject(xhr.responseJSON && xhr.responseJSON.message || xhr);
                    });
            } else {
                app.whenLoaded.reject(new Error("WeavyApp.fetchOrCreate() requires options"));
            }

            return app.whenLoaded();
        }

        function bridgePanelEvent(eventName, panelId, triggerData, e, data) {
            if (data.panelId === panelId) {
                for (var tProp in triggerData) {
                    if (Object.prototype.hasOwnProperty.call(data, tProp)) {
                        triggerData[tProp] = data[tProp];
                    }
                }
                var eventResult = app.triggerEvent(eventName, triggerData);
                if (eventResult === false) {
                    return false;
                } else if (eventResult) {
                    for (var dProp in data) {
                        if (Object.prototype.hasOwnProperty.call(eventResult, dProp)) {
                            data[dProp] = eventResult[dProp];
                        }
                    }
                    return data;
                }
            }
        }

        this.build = function () {
            weavy.authentication.whenAuthorized().then(function () {
                var root = app.root || app.space && app.space.root;

                if (app.options && app.data) {
                    if (!root && app.container) {
                        try {
                            app.root = root = weavy.createRoot(app.container, "app-" + app.id);
                            root.container.panels = weavy.panels.createContainer("app-container-" + app.id);
                            root.container.panels.eventParent = app;
                            root.container.appendChild(root.container.panels);
                        } catch (e) {
                            weavy.log("could not create app in container");
                        }
                    }

                    if (!app.isBuilt && root) {
                        app.isBuilt = true;
                        weavy.debug("Building app", app.id);
                        var panelId = "app-" + app.id;
                        var controls = app.options && app.options.controls !== undefined ? app.options.controls : (app.space.options && app.space.options.controls !== undefined ? app.space.options.controls : false);
                        app.panel = root.container.panels.addPanel(panelId, app.url, { controls: controls });

                        weavy.on("panel-open", bridgePanelEvent.bind(app, "open", panelId, { space: app.space, app: app, destination: null }));
                        weavy.on("panel-toggle", bridgePanelEvent.bind(app, "toggle", panelId, { space: app.space, app: app, destination: null }));
                        weavy.on("panel-close", bridgePanelEvent.bind(app, "close", panelId, { space: app.space, app: app }));

                        app.whenBuilt.resolve();
                    }
                }

            })
        };

        weavy.on("build", app.build.bind(app));

        app.whenBuilt().then(function () {
            if (app.autoOpen) {
                app.open();
            }
        });

        weavy.on("signed-in", function () {
            if (app.autoOpen) {
                // Reopen on sign in
                app.open();
            }
        });

        app.configure();
    };


    WeavyApp.prototype.open = function (destination) {
        var app = this;
        return app.whenBuilt().then(function () {
            var openPromises = [app.panel.open(destination)];

            // Sibling apps should be closed if the space is a tabbed space
            if (app.space && app.space.tabbed) {
                Array.from(app.space.apps || []).forEach(function (spaceApp) {
                    if (spaceApp !== app) {
                        openPromises.push(spaceApp.panel.close(true));
                    }
                });
            }

            return Promise.all(openPromises);
        });
    }

    WeavyApp.prototype.close = function () {
        var app = this;
        app.autoOpen = false;
        return app.whenBuilt().then(function () {
            return app.panel.close();
        });
    }

    WeavyApp.prototype.toggle = function (destination) {
        var app = this;

        return app.whenBuilt().then(function () {
            var isOpen = app.panel.isOpen;
            var togglePromises = [app.panel.toggle(destination)];

            // Sibling apps should be closed if the space is a tabbed space
            if (!isOpen && app.space && app.space.tabbed) {
                Array.from(app.space.apps || []).forEach(function (spaceApp) {
                    if (spaceApp !== app) {
                        togglePromises.push(spaceApp.panel.close(true));
                    }
                });
            }

            return Promise.all(togglePromises);
        });
    }

    WeavyApp.prototype.remove = function () {
        var app = this;
        var space = this.space;
        var weavy = this.weavy;

        weavy.debug("Removing app", app.id);

        var whenPanelRemoved = app.panel ? app.panel.remove() : Promise.resolve();

        var whenRemoved = whenPanelRemoved.then(function () {
            var appRoot = weavy.getRoot("app-" + app.id);
            if (appRoot) {
                appRoot.remove();
            }
        });

        space.apps = space.apps.filter(function (a) { return !a.match(app) });

        return whenRemoved;
    }

    WeavyApp.prototype.match = function (options) {
        if (options) {
            if (options.id && this.id) {
                return options.id === this.id
            }

            if (options.key && this.key) {
                return utils.ciEq(options.key, this.key);
            }
        }

        return false;
    };

    return WeavyApp;
}));


/**
 * @external Promise
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
 */
;
/* eslint-env commonjs, amd */

// UMD based on https://github.com/umdjs/umd/blob/master/templates/returnExports.js
// TODO: move to ES6 and transpiler

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            'jquery',
            './app',
            './utils',
            './promise'
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(
            require('jquery'),
            require('./app'),
            require('./utils'),
            require('./promise')
        );
    } else {
        // Browser globals (root is window)
        root.WeavySpace = factory(
            jQuery,
            root.WeavyApp,
            root.WeavyUtils,
            root.WeavyPromise
        );
    }
}(typeof self !== 'undefined' ? self : this, function ($, WeavyApp, utils, WeavyPromise) {
    console.debug("space.js");

    var WeavySpace = function (weavy, options, data) {
        /** 
         *  Reference to this instance
         *  @lends WeavySpace#
         */
        var space = this;

        this.id = null;
        this.name = null;
        this.key = null;

        this.weavy = weavy;

        /**
         * Options for the space
         * @member {Object} space.options
         * @property {} space.options.apps
         * @property {} space.options.container
         * @property {boolean} space.options.tabbed
         */
        this.options = options;
        this.data = data;

        this.apps = new Array();

        // Event handlers
        this.eventParent = weavy;
        this.on = weavy.events.on.bind(space);
        this.one = weavy.events.one.bind(space);
        this.off = weavy.events.off.bind(space);
        this.triggerEvent = weavy.events.triggerEvent.bind(space);

        this.isLoaded = false;
        this.isBuilt = false;

        this.whenLoaded = new WeavyPromise();
        this.whenBuilt = new WeavyPromise();

        // Use tabbed option otherwise false.
        this.tabbed = options.tabbed !== undefined ? options.tabbed : false;

        this.configure = function (options, data) {

            if (options && typeof options === "object") {
                space.options = space.weavy.extendDefaults(space.options, options, true);
            }

            if (data && typeof data === "object") {
                space.data = data;
            }

            if (space.options && typeof space.options === "object") {
                space.container = space.options.container;

                if (space.id === null && space.options.id) {
                    space.id = space.options.id;
                }

                if (space.key === null && space.options.key) {
                    space.key = space.options.key;
                }

                if (space.name === null && space.options.name) {
                    space.name = space.options.name;
                }

                if (space.options.apps) {
                    var optionsApps = utils.asArray(space.options.apps);

                    optionsApps.forEach(function (appOptions) {
                        var foundApps = space.apps.filter(function (app) { return app.match(appOptions); });
                        if (foundApps.length === 0) {
                            space.apps.push(new WeavyApp(weavy, space, appOptions));
                        }
                    });
                }


            }

            if (space.data && typeof space.data === "object") {
                space.id = space.data.id;
                space.name = space.data.name;

                if (!space.key && space.data.key) {
                    space.key = space.data.key;
                }

                if (space.data.apps) {
                    var dataApps = utils.asArray(space.data.apps);

                    space.apps.forEach(function (app) {
                        var foundAppData = dataApps.filter(function (appData) { return app.match(appData) }).pop();
                        if (foundAppData) {
                            weavy.debug("Populating app data", { id: foundAppData.id, key: foundAppData.key || app.key, type: foundAppData.type || app.type });
                            app.data = foundAppData;
                            app.configure();
                        }
                    })
                }

                space.isLoaded = true;
                space.whenLoaded.resolve(space.data);

                if (space.weavy.isLoaded) {
                    space.build();
                }

            }
        }

        this.fetchOrCreate = function (options) {
            if (options && typeof options === "object") {
                space.options = options;
            }

            if (space.options && typeof space.options === "object") {
                var initSpaceUrl = weavy.httpsUrl("/client/space", weavy.options.url);

                weavy.ajax(initSpaceUrl, space.options, "POST").then(function (data) {
                    space.data = data;
                    space.configure.call(space);
                }).catch(function (xhr, status, error) {
                    space.weavy.error("WeavySpace.fetchOrCreate()", xhr.responseJSON && xhr.responseJSON.message || xhr);
                    space.whenLoaded.reject(xhr.responseJSON && xhr.responseJSON.message || xhr);
                });
            } else {
                space.whenLoaded.reject(new Error("WeavySpace.fetchOrCreate() requires options"));
            }
            return space.whenLoaded();
        }

        this.build = function (e, build) {
            var space = this;
            var weavy = this.weavy;
            if (weavy.authentication.isAuthorized() && space.data && typeof space.data === "object") {
                weavy.debug("Building space", space.id);

                if (!space.root && space.container) {
                    space.isBuilt = true;
                    space.root = weavy.createRoot(space.container, "space-" + space.id);
                    space.root.container.panels = weavy.panels.createContainer();
                    space.root.container.appendChild(space.root.container.panels);
                    space.whenBuilt.resolve();
                }
            }
        }

        space.weavy.on("build", space.build.bind(space));

        space.configure();

    };

    function getAppSelector(appOptions) {
        var isId = Number.isInteger(appOptions);
        var isKey = typeof appOptions === "string";
        var isConfig = $.isPlainObject(appOptions);

        var selector = isConfig && appOptions || isId && { id: appOptions } || isKey && { key: appOptions };

        if (!selector) {
            if ('id' in appOptions) {
                selector = { id: appOptions.id };
            } else if ('key' in appOptions) {
                selector = { key: appOptions.key };
            }
        }

        return { isId: isId, isKey: isKey, isConfig: isConfig, selector: selector };
    }

    WeavySpace.prototype.app = function (appOptions) {
        var space = this;
        var weavy = this.weavy;
        var app;

        var appSelector = getAppSelector(appOptions);

        if (appSelector.selector) {
            try {
                app = space.apps.filter(function (a) { return a.match(appSelector.selector) }).pop();
            } catch (e) { }

            if (!app) {
                if (appSelector.isConfig) {
                    app = new WeavyApp(weavy, space, appOptions);
                    space.apps.push(app);
                    $.when(weavy.authentication.whenAuthorized(), weavy.whenLoaded(), space.whenLoaded()).then(function () {
                        app.fetchOrCreate();
                    });
                } else {
                    weavy.warn("App " + (appSelector.isConfig ? JSON.stringify(appSelector) : appOptions) + " does not exist." + (appSelector.isId ? "" : " \n Use weavy.space(" + (space.key && "\"" + space.key + "\"" || space.id || "...") + ").app(" + JSON.stringify(appSelector.selector) + ") to create the app."))
                }
            }
        }

        return app;
    }

    WeavySpace.prototype.remove = function () {
        var space = this;
        var weavy = this.weavy;

        weavy.debug("Removing space", space.id);

        var whenAllRemoved = [];

        this.apps.forEach(function (app) {
            whenAllRemoved.push(app.remove());
        })

        weavy.spaces = weavy.spaces.filter(function (s) { return !s.match(space) });

        return Promise.all(whenAllRemoved).then(function () {
            var spaceRoot = weavy.getRoot("space-" + space.id);
            if (spaceRoot) {
                spaceRoot.remove();
            }
        });
    }

    WeavySpace.prototype.match = function (options) {
        if (options) {
            if (options.id && this.id) {
                return options.id === this.id
            }

            if (options.key && this.key) {
                return utils.ciEq(options.key, this.key);
            }
        }

        return false;
    };

    return WeavySpace;
}));


/**
 * @external Promise
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
 */

;
/* eslint-env commonjs, amd */

// UMD based on https://github.com/umdjs/umd/blob/master/templates/returnExports.js
// TODO: move to ES6 and transpiler

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            'jquery',
            './promise'
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(
            require('jquery'),
            require('./promise')
        );
    } else {
        // Browser globals (root is window)
        root.WeavyNavigation = factory(jQuery, root.WeavyPromise);
    }
}(typeof self !== 'undefined' ? self : this, function ($, WeavyPromise) {
    console.debug("navigation.js");

    /**
     * Class for handling internal/external navigation
     * 
     * @module navigation
     * @returns {WeavyNavigation}
     */
    var WeavyNavigation = function (weavy, options) {

        var navigation = this;

        this.options = options = weavy.extendDefaults(WeavyNavigation.defaults, options);

        function openRequest(request) {
            var whenOpened = new WeavyPromise();

            if (request.space && request.app && (request.space.id || request.space.key) && (request.app.id || request.app.key)) {

                var appCount = weavy.spaces.reduce(function (sum, space) {
                    return sum + space.apps.length;
                }, 0);

                var rejectCount = 0;

                var reject = function () {
                    rejectCount++;
                    if (rejectCount >= appCount) {
                        weavy.info("navigation: app " + (request.app.key || request.app.id) + " not found");
                        whenOpened.reject();
                    }
                }

                weavy.spaces.forEach(function (space) {
                    space.whenLoaded().then(function () {
                        if (request.space.id && space.id === request.space.id || request.space.key && space.key === request.space.key) {
                            space.apps.forEach(function (app) {
                                app.whenLoaded().then(function () {
                                    if (request.app.id && app.id === request.app.id || request.app.key && app.key === request.app.key) {
                                        weavy.log("navigation: app " + (request.app.key || request.app.id) + " open " + request.url);
                                        app.open(request.url).then(function (open) {
                                            whenOpened.resolve(open);
                                        });
                                    } else {
                                        reject(app)
                                    }
                                });
                            });
                        } else {
                            space.apps.forEach(reject);
                        }
                    });
                });
            } else {
                weavy.warn("navigation: url was not resolved to an app");
                whenOpened.reject();
            }

            return whenOpened();
        }
        /**
         * Try to open an url in the app where it belongs. Automaticalyy finds out where to open the url unless routing data is provided in a {NavigationRequest} object.
         * 
         * @param {string|NavigationRequest} request - String Url or a {NavigationRequest} object with route data.
         */
        this.open = function (request) {
            var isUrl = typeof request === "string";
            var isNavigationRequest = $.isPlainObject(request) && request.url;

            if (isUrl) {
                return weavy.ajax("/client/click?url=" + encodeURIComponent(request)).then(openRequest);
            } else if (isNavigationRequest) {
                return openRequest(request);
            }
        };

        weavy.on(wvy.postal, "navigation-open", weavy.getId(), function (e) {
            /**
             * Navigation event triggered when a page should be opened in another space or app.
             * 
             * @event navigate
             * @property {NavigationRequest} route - Data about the requested navigation
             * 
             */
            var eventResult = weavy.triggerEvent("before:navigate", e.data.route);
            if (eventResult !== false) {
                weavy.info("navigate: trying internal auto navigation");
                navigation.open(eventResult).catch(function () {
                    // Only trigger on: and after: if .open was unsuccessful
                    eventResult = weavy.triggerEvent("on:navigate", eventResult);
                    if (eventResult !== false) {
                        weavy.triggerEvent("after:navigate", eventResult);
                    }
                });
            }
        })

    };


    /**
     * Default class options
     * 
     * @example
     * WeavyNavigation.defaults = {
     *     sound: {
     *         preload: "none",
     *         src: "/media/notification.mp3"
     *     }
     * };
     * 
     * @name defaults
     * @memberof navigation
     * @type {Object}
     * @property {string} sound.preload=none - Preload setting for the {@link notifications#nodes#notificationSound}
     * @property {url} sound.src - Url to the notification sound
     */
    WeavyNavigation.defaults = {
        
    };

    return WeavyNavigation;
}));

/**
 * @typedef navigationRequest
 * @type Object
 * @property space
 * @property {int} space.id - The server generated id for the space
 * @property {string} space.key - The key identifier the space
 * @property app
 * @property {int} app.id - The server generated id for the app
 * @property {string} app.key - The key identifier for the app
 * @property {string} url - The url to open
 */ 


/**
 * @external Promise
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
 */
;
/* eslint-env commonjs, amd */

// UMD based on https://github.com/umdjs/umd/blob/master/templates/returnExports.js
// TODO: move to ES6 and transpiler

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            'jquery',
            './events',
            './panels',
            './space',
            './navigation',
            './utils',
            './console',
            './promise'
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(
            require('jquery'),
            require('./events'),
            require('./panels'),
            require('./space'),
            require('./navigation'),
            require('./utils'),
            require('./console'),
            require('./promise')
        );
    } else {
        // Browser globals (root is window)
        root.Weavy = factory(
            jQuery,
            root.WeavyEvents,
            root.WeavyPanels,
            root.WeavySpace,
            root.WeavyNavigation,
            root.WeavyUtils,
            root.WeavyConsole,
            root.WeavyPromise
        );
    }
}(typeof self !== 'undefined' ? self : this, function ($, WeavyEvents, WeavyPanels, WeavySpace, WeavyNavigation, utils, WeavyConsole, WeavyPromise) {
    console.debug("weavy.js");

    // DEFINE CUSTOM ELEMENTS AND STYLES

    if ('customElements' in window) {
        try {
            window.customElements.define('weavy-root', HTMLElement.prototype);
            window.customElements.define('weavy-container', HTMLElement.prototype);
        } catch(e) { }
    } 

    var weavyElementCSS = 'weavy, weavy-root { display: contents; }';

    if (!('CSS' in window && CSS.supports('display', 'contents'))) {
        weavyElementCSS = 'weavy, weavy-root { display: flex; position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; }';
    }

    if (document.adoptedStyleSheets) {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(weavyElementCSS);
        document.adoptedStyleSheets = Array.prototype.concat.call(document.adoptedStyleSheets, [sheet]);
    } else {
        var elementStyleSheet = document.createElement("style");
        elementStyleSheet.type = "text/css";
        elementStyleSheet.styleSheet ? elementStyleSheet.styleSheet.cssText = weavyElementCSS : elementStyleSheet.appendChild(document.createTextNode(weavyElementCSS));

        document.getElementsByTagName("head")[0].appendChild(elementStyleSheet);
    }

    // WEAVY

    var _weavyIds = [];

    /**
     * All options are optional. You may use multiple Weavy.presets together with options when constructing a weavy instance. Multiple option sets are merged together.
     * 
     * If you want to connect to a specific server use the [url option]{@link Weavy#options}.
     * 
     * These option presets are available for easy configuration
     * * Weavy.presets.noplugins - Disable all plugins
     * * Weavy.presets.core - Use the minimal core plugin configuration without additional plugins.
     * 
     * @example
     * var weavy = new Weavy();
     * var coreDevWeavy = new Weavy(Weavy.presets.core, { url: "http://myweavysite.dev" });
     * 
     * @class Weavy
     * @classdesc The core class for Weavy.
     * @param {...Weavy#options} options - One or multiple option sets. Options will be merged together in order.
     * @typicalname weavy
     */

    var Weavy = function () {
        /** 
         *  Reference to this instance
         *  @lends Weavy#
         */
        var weavy = this;

        /**
         * Main options for Weavy. 
         * When weavy initializes, it connects to the server and processes the options and sends them back to weavy again. The options may then contain additional data. 
         * Weavy triggers a {@link Weavy#event:options} event when options are recieved from the server.
         * 
         * @category options
         * @typedef 
         * @type {Object}
         * @member
         * @property {Element} [container] - Container where weavy should be placed. If no Element is provided, a &lt;section&gt; is created next to the &lt;body&gt;-element.
         * @property {string} [className] - Additional classNames added to weavy.
         * @property {string} [https=adaptive] - How to enforce https-links. <br> • **force** -  makes all urls https.<br> • **adaptive** - enforces https if the calling site uses https.<br> • **default** - makes no change.
         * @property {string} [id] - An id for the instance. A unique id is always generated.
         * @property {boolean} [init=true] - Should weavy initialize automatically.
         * @property {boolean} [isMobile] - Indicates if the browser is mobile. Defaults to the RegExp expression <code>/iPhone&#124;iPad&#124;iPod&#124;Android/i.test(navigator.userAgent)</code>
         * @property {boolean} [includePlugins=true] - Whether all registered plugins should be enabled by default. If false, then each plugin needs to be enabled in plugin-options.
         * @property {string} [logColor] - Hex color (#bada55) used for logging. A random color is generated as default.
         * @property {Element} [overlay] - Element to use for overlay purposes. May for instance use the overlay of another Weavy instance.
         * @property {Object<string, Object>} [plugins] - Properties with the name of the plugins to configure. Each plugin may be enabled or disabled by setting the options to true or false. Providing an Object instead of true will enable the plugin and pass options to the plugin. See the reference for each plugin for available options.
         * @property {string} [url] - The URL of the Weavy-installation to connect to. Defaults to the installation where the script came from.
         */
        weavy.options = weavy.extendDefaults(Weavy.defaults);

        // Extend default options with the passed in arugments
        for (var arg in arguments) {
            if (arguments[arg] && typeof arguments[arg] === "object") {
                weavy.options = weavy.extendDefaults(weavy.options, arguments[arg], true);
            }
        }

        function generateId(id) {
            id = "wy-" + (id ? id.replace(/^wy-/, '') : utils.S4() + utils.S4());

            // Make sure id is unique
            if (_weavyIds.indexOf(id) !== -1) {
                id = generateId(id + utils.S4());
            }

            return id;
        }

        weavy.options.id = generateId(weavy.options.id);
        _weavyIds.push(weavy.options.id);

        // Logging

        this.console = new WeavyConsole(weavy.options.id, weavy.options.loggingColor, weavy.options.logging);

        this.log = this.console.log;
        this.debug = this.console.debug;
        this.warn = this.console.warn;
        this.error = this.console.error;
        this.info = this.console.info;

        /**
         * The hardcoded semver version of the weavy-script.
         * @member {string} Weavy.version 
         */
        if (Weavy.version) {
            weavy.options.version = weavy.options.version || Weavy.version;
            weavy.log(Weavy.version);
        }

        if (!weavy.options.url || weavy.options.url === "/") {
            weavy.error("Required url not specified.\nnew Weavy({ url: \"https://mytestsite.weavycloud.com/\" })");
        }

        /**
         * Data about the current user.
         * Use weavy.user.id to get the id of the user.
         * 
         * @category properties
         * @type {Object}
         */
        weavy.user = null;

        /**
         * Loaded data for the current user.
         * 
         * @category properties
         * @type {Object}
         */
        weavy.data = null;

        /**
         * True when frames are blocked by Content Policy or the browser
         * 
         * @category properties
         * @type {boolean}
         */
        weavy.isBlocked = false;

        /**
         * True when weavy is loading options from the server.
         * 
         * @category properties
         * @type {boolean}
         */
        weavy.isLoading = false;

        /**
         * True when weavy has loaded options from the server.
         * 
         * @category properties
         * @type {boolean}
         */
        weavy.isLoaded = false;


        // DOM Elements

        /**
         * Placeholder for all DOM node references. Put any created elements or DOM related objects here.
         * 
         * @alias Weavy#nodes
         * @typicalname weavy.nodes
         */
        weavy.nodes = {}; // TODO: Use weakmap instead?

        /**
         * The main container under the root. This is where all weavy Elements are placed.
         * 
         * @alias Weavy#nodes#container
         * @type {Element}
         */
        weavy.nodes.container = null;

        /**
         * Container for displaying elements that needs to be full viewport and on top of other elements. Uses [options.overlay]{@link Weavy#options} if specified.
         * 
         * @alias Weavy#nodes#overlay
         * @type {Element}
         */
        weavy.nodes.overlay = null;

        /**
         * Container for all global overlay panels
         * 
         * @alias Weavy#nodes#panels
         * @type {Element}
         */
        weavy.nodes.panels = {};

        // EVENT HANDLING
        weavy.events = new WeavyEvents(weavy);

        weavy.on = weavy.events.on;
        weavy.one = weavy.events.one;
        weavy.off = weavy.events.off;
        weavy.triggerEvent = weavy.events.triggerEvent;


        // AUTHENTICATION & JWT
        weavy.authentication = wvy.authentication.get(weavy.httpsUrl(weavy.options.url));

        if (weavy.options.jwt === undefined) {
            weavy.error("specify a jwt string or a provider function")
        }

        weavy.authentication.init(weavy.options.jwt);

        weavy.on(weavy.authentication, "user", function (e, auth) {
            weavy.user = auth.user;

            if (/^signed-in|signed-out|changed-user|user-error$/.test(auth.state)) {

                if (auth.state === "changed-user") {
                    weavy.triggerEvent("signed-out", { id: -1 });
                    weavy.triggerEvent("signed-in", auth);
                } else {
                    weavy.triggerEvent(auth.state, auth);
                }

                weavy.data = null;

                // Refresh client data
                loadClientData();
            }
        });

        weavy.on(weavy.authentication, "signing-in", function (e) {
            weavy.triggerEvent("signing-in");
        });

        weavy.on(weavy.authentication, "clear-user", function (e) {
            weavy.triggerEvent("clear-user");
        });

        weavy.on(weavy.authentication, "authentication-error", function (e, error) {
            weavy.triggerEvent("authentication-error", error);
        });

        // WEAVY REALTIME CONNECTION
        weavy.connection = wvy.connection.get(weavy.httpsUrl(weavy.options.url));


        // PANELS
        weavy.panels = new WeavyPanels(weavy);

        weavy.on("before:build", function () {
            if (!weavy.nodes.panels.drawer) {
                weavy.nodes.panels.drawer = weavy.panels.createContainer();
                weavy.nodes.panels.drawer.classList.add("weavy-drawer");
                weavy.nodes.overlay.appendChild(weavy.nodes.panels.drawer);
            }

            if (!weavy.nodes.panels.preview) {
                weavy.nodes.panels.preview = weavy.panels.createContainer();
                weavy.nodes.panels.preview.classList.add("weavy-preview");
                weavy.nodes.overlay.appendChild(weavy.nodes.panels.preview);
            }
        });

        weavy.on("after:panel-open", function (e, open) {
            if (open.panels === weavy.nodes.panels.drawer) {
                weavy.nodes.panels.drawer.classList.add("weavy-drawer-in");
            }
        });

        weavy.on("after:panel-close", function (e, close) {
            if (close.panels === weavy.nodes.panels.drawer) {
                weavy.nodes.panels.drawer.classList.remove("weavy-drawer-in");
            }
        });


        // SPACES

        weavy.spaces = new Array();

        /**
         * Set up weavy spaces
         */
        weavy.space = function (options) {
            var space;

            var isSpaceId = Number.isInteger(options);
            var isSpaceKey = typeof options === "string";
            var isSpaceConfig = $.isPlainObject(options);
            var spaceSelector = isSpaceConfig && options || isSpaceId && { id: options } || isSpaceKey && { key: options };

            if (spaceSelector) {
                try {
                    space = weavy.spaces.filter(function (s) { return s.match(spaceSelector) }).pop();
                } catch (e) {}

                if (!space) {
                    if (isSpaceConfig) {
                        space = new WeavySpace(weavy, options);
                        weavy.spaces.push(space);
                        $.when(weavy.authentication.whenAuthorized(), weavy.whenLoaded()).then(function () {
                            space.fetchOrCreate();
                        });
                    } else {
                        weavy.warn("Space " + (isSpaceConfig ? JSON.stringify(spaceSelector) : options) + " does not exist." + (isSpaceId ? "" : " \n Use weavy.space(" + JSON.stringify(spaceSelector) + ") to create the space."))
                    }
                }
            }
            return space;
        };

        // TIMEOUT HANDLING 

        var _timeouts = [];

        function clearTimeouts() {
            _timeouts.forEach(clearTimeout);
            _timeouts = [];
        }


        /**
         * Creates a managed timeout promise. Use this instead of window.setTimeout to get a timeout that is automatically managed and unregistered on destroy.
         * 
         * @example
         * var mytimeout = weavy.timeout(200).then(function() { ... });
         * mytimeout.reject(); // Cancel the timeout
         * 
         * @category promises
         * @param {int} time=0 - Timeout in milliseconds
         * @returns {external:Promise}
         */
        weavy.timeout = function (time) {
            var timeoutId;
            var whenTimeout = new WeavyPromise();

            _timeouts.push(timeoutId = setTimeout(function () { whenTimeout.resolve(); }, time));

            whenTimeout.catch(function () {
                clearTimeout(timeoutId);
            });

            return whenTimeout;
        };

        // PROMISES

        /**
         * Promise that the blocking check has finished. Resolves when {@link Weavy#event:frame-check} is triggered.
         *
         * @example
         * weavy.whenReady().then(function() { ... })
         *
         * @category promises
         * @type {external:Promise}
         * @resolved when frames are not blocked.
         * @rejected when frames are blocked
         * */
        weavy.whenReady = new WeavyPromise();

        weavy.on("frame-check", function (e, framecheck) {
            framecheck.blocked ? weavy.whenReady.reject() : weavy.whenReady.resolve();
        });

        /**
         * Promise that weavy has recieved the after:load event
         *
         * @example
         * weavy.whenLoaded().then(function() { ... })
         *
         * @category promises
         * @type {external:Promise}
         * @resolved when init is called, the websocket has connected, data is received from the server and weavy is built and the load event has finished.
         */
        weavy.whenLoaded = new WeavyPromise();

        weavy.on("processed:load", function () {
            weavy.whenLoaded.resolve();
        });

        /**
         * Initializes weavy. This is done automatically unless you specify `init: false` in {@link Weavy#options}.
         * @param {Weavy#options} [options] Any new or additional options.
         * @emits Weavy#init
         */
        weavy.init = function (options) {

            weavy.options = weavy.extendDefaults(weavy.options, options);

            /**
             * Event that is triggered when the weavy instance is initiated. This is done automatically unless you specify `init: false` in {@link Weavy#options}.
             * You may use the `before:init` event together with `event.stopPropagation()` if you want to intercept the initialization.
             * 
             * @category events
             * @event Weavy#init
             * @returns {external:Promise}
             */
            return weavy.triggerEvent("init");
        }

        // INTERNAL FUNCTIONS

        function disconnect(async, notify) {
            weavy.log("disconnecting weavy");

            // NOTE: stop/disconnect directly if we are not authenticated 
            // signalr does not allow the user identity to change in an active connection
            return weavy.connection.disconnect(async, notify);
        }

        function loadClientData() {
            if (!weavy.isLoading) {
                if (weavy.isLoaded) {
                    weavy.whenLoaded.reset();
                }

                weavy.isLoaded = false;
                weavy.isLoading = true;
 
                weavy.options.href = window.location.href;

                var authUrl = weavy.httpsUrl("/client/init", weavy.options.url);

                var initData = {
                    spaces: weavy.options.spaces,
                    plugins: weavy.options.plugins,
                    version: weavy.options.version
                }

                weavy.ajax(authUrl, initData, "POST", null, true).then(function (clientData) {
                    weavy.triggerEvent("clientdata", clientData);
                });
            }
            return weavy.whenLoaded();
        }


        var _roots = new Map();

        weavy.createRoot = function (parentSelector, id) {
            var supportsShadowDOM = !!HTMLElement.prototype.attachShadow;

            var rootId = weavy.getId(id);

            if (!parentSelector) {
                weavy.error("No parent container defined for createRoot", rootId);
                return;
            }
            if (_roots.has(rootId)) {
                weavy.warn("Root already created", rootId);
                return _roots.get(rootId);
            }

            var parentElement = $(parentSelector)[0];

            var rootSection = document.createElement("weavy");

            rootSection.id = rootId;
            //rootSection.classList.add("weavy");
            //rootSection.style.display = "contents";

            var rootDom = document.createElement("weavy-root");
            rootDom.setAttribute("data-version", weavy.options.version);

            var rootContainer = document.createElement("weavy-container");
            rootContainer.className = "weavy-container";
            rootContainer.id = weavy.getId("weavy-container-" + weavy.removeId(rootId));     

            var root = { parent: parentElement, section: rootSection, root: rootDom, container: rootContainer, id: rootId };

            weavy.triggerEvent("before:create-root", root);

            parentElement.appendChild(rootSection);
            rootSection.appendChild(rootDom);

            if (supportsShadowDOM) {
                root.root = rootDom = rootDom.attachShadow({ mode: "closed" });
            }
            rootDom.appendChild(rootContainer);

            weavy.triggerEvent("on:create-root", root);

            root.remove = function () {
                weavy.triggerEvent("before:remove-root", root);

                $(root.container).remove();
                $(root.section).remove();

                weavy.triggerEvent("on:remove-root", root);

                _roots.delete(rootId);

                weavy.triggerEvent("after:remove-root", root);
            };

            weavy.triggerEvent("after:create-root", root);

            _roots.set(rootId, root);

            return root;
        };

        weavy.getRoot = function (id) {
            return _roots.get(weavy.getId(id));
        }

        function frameStatusCheck() {
            var statusUrl = "/client/ping";

            if (!weavy.nodes.statusFrame) {
                // frame status checking
                weavy.nodes.statusFrame = document.createElement("iframe");
                weavy.nodes.statusFrame.className = "weavy-status-check weavy-hidden";
                weavy.nodes.statusFrame.style.display = "none";
                weavy.nodes.statusFrame.id = weavy.getId("weavy-status-check");
                weavy.nodes.statusFrame.setAttribute("name", weavy.getId("weavy-status-check"));

                weavy.one(wvy.postal, "ready", weavy.getId("weavy-status-check"), function () {
                    weavy.log("Frame status check", "√")
                    weavy.isBlocked = false;
                    weavy.triggerEvent("frame-check", { blocked: false });
                });

                weavy.nodes.container.appendChild(weavy.nodes.statusFrame);
                weavy.timeout(1).then(function () {
                    weavy.nodes.statusFrame.src = weavy.httpsUrl(statusUrl, weavy.options.url);
                    weavy.isBlocked = true;

                    try {
                        wvy.postal.registerContentWindow(weavy.nodes.statusFrame.contentWindow, weavy.getId("weavy-status-check"), weavy.getId("weavy-status-check"));
                    } catch (e) {
                        weavy.warn("Frame postMessage is blocked", e);
                        weavy.triggerEvent("frame-check", { blocked: true });
                    }
                });
            }

            return weavy.whenReady();
        }

        function initRoot() {
            // add container
            if (!weavy.getRoot()) {
                // append container to target element || html
                var rootParent = $(weavy.options.container)[0] || document.documentElement;

                var root = weavy.createRoot.call(weavy, rootParent);
                weavy.nodes.container = root.root;
                weavy.nodes.overlay = root.container;

                weavy.nodes.overlay.classList.add("weavy-overlay");
            }
        }


        // PUBLIC METHODS

        /**
         * Appends the weavy-id to an id. This makes the id unique per weavy instance. You may define a specific weavy-id for the instance in the {@link Weavy#options}. If no id is provided it only returns the weavy id. The weavy id will not be appended more than once.
         * 
         * @param {string} [id] - Any id that should be completed with the weavy id.
         * @returns {string} Id completed with weavy-id. If no id was provided it returns the weavy-id only.
         */
        weavy.getId = function (id) {
            return id ? weavy.removeId(id) + "-" + weavy.options.id : weavy.options.id;
        }

        /**
         * Removes the weavy id from an id created with {@link Weavy#getId}
         * 
         * @param {string} id - The id from which the weavy id will be removed.
         * @returns {string} Id without weavy id.
         */
        weavy.removeId = function (id) {
            return id ? String(id).replace(new RegExp("-" + weavy.getId() + "$"), '') : id;
        };


        /**
         * Method for calling JSON API endpoints on the server. You may send data along with the request or retrieve data from the server.
         * 
         * jQuery ajax is used internally and you may override or extend any settings in the {@link external:jqXHR} by providing custom [jQuery Ajax settings]{@link external:jqAjaxSettings}.
         * 
         * You may of course call the endpoints using any other preferred AJAX method, but this method is preconfigured with proper encoding and crossdomain settings.
         *
         * @param {string} url - URL to the JSON endpoint. May be relative to the connected server.
         * @param {object} [data] - Data to send. May be an object that will be encoded or a string with pre encoded data.
         * @param {string} [method=GET] - HTTP Request Method {@link https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods}
         * @param {external:jqAjaxSettings} [settings] - Settings to extend or override [jQuery Ajax settings]{@link external:jqAjaxSettings}.
         * @returns {external:jqXHR} {@link external:Promise}
         * 
         * @example <caption>Requires custom endpoints on the server, normally included in a sandbox installation.</caption>
         * // Create a space and open it as a panel
         * weavy.ajax("/api/spaces/", { name: "My Space" }, "POST").then(function(result) {
         *   weavy.panels.addPanel("space" + result.id, result.url);
         *   weavy.panels.open("space" + result.id);
         * });
         *
         * // Search for a space
         * weavy.ajax("/api/search", { q: "My Space", et: "space"}).then(function(result) {
         *   console.log("Found " + result.count + " results");
         * });
         */
        weavy.ajax = function (url, data, method, settings, allowAnonymous) {
            url = weavy.httpsUrl(url, weavy.options.url);
            method = method || "GET";
            data = data && typeof data === "string" && data || method !== "GET" && data && JSON.stringify(data) || data;

            settings = weavy.extendDefaults({
                url: url,
                method: method,
                data: data,
                contentType: "application/json",
                crossDomain: true,
                dataType: "json",
                dataFilter: function (data, dataType) {
                    return dataType === "json" ? JSON.stringify(utils.keysToCamel(JSON.parse(data))) : data;
                },
                xhrFields: {
                    withCredentials: true
                },
                headers: {
                    // https://stackoverflow.com/questions/8163703/cross-domain-ajax-doesnt-send-x-requested-with-header
                    "X-Requested-With": "XMLHttpRequest"
                }
            }, settings, true);

            var whenAuthenticated = allowAnonymous ? weavy.authentication.whenAuthenticated : weavy.authentication.whenAuthorized;

            return whenAuthenticated().then(function () {
                return weavy.authentication.getJwt().then(function (token) {
                    var whenAjax = new WeavyPromise();

                    if (typeof token === "string") {
                        // JWT configured, use bearer token
                        settings.headers.Authorization = "Bearer " + token;
  
                        $.ajax(settings).then(
                            function (data, textStatus, jqXHR) {
                                whenAjax.resolve(data, textStatus, jqXHR);
                            },
                            function (jqXHR, textStatus, errorThrown) {
                                if (jqXHR.status === 401) {
                                    weavy.warn("weavy.ajax: JWT failed, trying again");
                                    return weavy.authentication.getJwt(true).then(function (token) {
                                        // new bearer token
                                        settings.headers.Authorization = "Bearer " + token;
                                        $.ajax(settings).then(
                                            function (data, textStatus, jqXHR) {
                                                whenAjax.resolve(data, textStatus, jqXHR);
                                            },
                                            function (jqXHR, textStatus, errorThrown) {
                                                whenAjax.reject(jqXHR, textStatus, errorThrown);
                                            }
                                        );
                                    })
                                } else {
                                    weavy.error("weavy.ajax: authenticate with JWT token failed", textStatus, jqXHR.responseJSON && jqXHR.responseJSON.message ? "\n" + jqXHR.responseJSON.message : errorThrown);
                                    whenAjax.reject(jqXHR, textStatus, errorThrown);
                                }
                            }
                        );
                    } else {
                        // JWT not configured, try without bearer token
                        $.ajax(settings).then(
                            function (data, textStatus, jqXHR) {
                                whenAjax.resolve(data, textStatus, jqXHR);
                            },
                            function (jqXHR, textStatus, errorThrown) {
                                whenAjax.reject(jqXHR, textStatus, errorThrown);
                            }
                        );
                    }

                    return whenAjax();
                });
            });
        }

        /**
         * Destroys the instance of Weavy. You should also remove any references to weavy after you have destroyed it. The [destroy event]{@link Weavy#event:destroy} will be triggered before anything else is removed so that plugins etc may unregister and clean up, before the instance is gone.
         * @param {boolean} [keepConnection=false] - Set to true if you want the realtime-connection to remain connected.
         * @emits Weavy#destroy
         */
        weavy.destroy = function (keepConnection) {
            /**
             * Event triggered when the Weavy instance is about to be destroyed. Use this event for clean up. 
             * - Any events registered using {@link Weavy#on} and {@link Weavy#one} will be unregistered automatically. 
             * - Timers using {@link Weavy#timeout} will be cleared automatically.
             * - All elements under the {@link Weavy#nodes#root} will be removed.
             * 
             * @category events
             * @event Weavy#destroy
             */
            weavy.triggerEvent("destroy", null);

            weavy.events.clear();
            clearTimeouts();

            _weavyIds.splice(_weavyIds.indexOf(weavy.getId()), 1);

            if (!keepConnection && _weavyIds.length === 0) {
                disconnect();
            }

            _roots.forEach(function (root) {
                root.remove();
            });

            // Delete everything in the instance
            for (var prop in weavy) {
                if (Object.prototype.hasOwnProperty.call(weavy, prop)) {
                    delete weavy[prop];
                }
            }
        }

        // EVENTS

        // Register init before any plugins do
        weavy.on("init", function () {

            // Prepopulate spaces
            if (weavy.options.spaces) {
                var spaces = utils.asArray(weavy.options.spaces);

                spaces.forEach(function (spaceOptions) {
                    if (weavy.spaces.filter(function (space) { return space.match(spaceOptions); }).length === 0) {
                        weavy.spaces.push(new WeavySpace(weavy, spaceOptions));
                    }
                });
            }

            return loadClientData().then(function () {
                var wFrameStatusCheck = frameStatusCheck.call(weavy);
                var wConnectionInit = weavy.connection.init(true, weavy.authentication);
                return $.when(wFrameStatusCheck, wConnectionInit);
            });
        });


        // MESSAGE EVENTS

        // listen for dispatched messages from weavy (close/resize etc.)
        weavy.on(wvy.postal, "message", function (message) {
            /**
                * THIS IS DEPRECATED. Use the weavy.on(wvy.postal, "message-name", function(e) { ... }); instead
                * 
                * Event for window messages directed to the current weavy instance, such as messages sent from panels belonging to the weavy instance.
                * The original message event is attached as event.originalEvent.
                * 
                * Use e.data.name to determine which type of message theat was receivied.
                * 
                * @deprecated
                * @category events
                * @event Weavy#message
                * @returns {Object.<string, data>}
                * @property {string} name - The name of the message
                * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage}
            */
            weavy.triggerEvent("message", message.data, message);
        });


        // REALTIME EVENTS


        weavy.on(weavy.connection, "badge.weavy", function (e, data) {

            /**
             * Triggers when the number of unread conversations or notifications change.
             * 
             * @example
             * weavy.on("badge", function (e, data) {
             *     weavy.log("New notifications count", data.notifications);
             *     weavy.log("Unread conversations count", data.conversations);
             * });
             * 
             * @event badge#badge
             * @category events
             * @returns {Object}
             * @property {int} conversations - Number of unread conversations
             * @property {int} notifications - Number of unread notifications
             * @property {int} total - The total number of unread conversations and notifications.
             */
            weavy.triggerEvent("badge", data);
        });

        weavy.on("clear-user signed-out", function () {
            weavy.triggerEvent("badge", { conversations: 0, notifications: 0, total: 0 });
        })

        weavy.on("clientdata", function (e, clientData) {

            // Merge options
            //weavy.data = weavy.extendDefaults(weavy.data, clientData, true);
            weavy.data = clientData;

            if (weavy.authentication.isAuthorized() && clientData.spaces) {
                var spaces = utils.asArray(clientData.spaces);

                spaces.forEach(function (spaceData) {
                    var foundSpace = weavy.spaces.filter(function (space) { return space.match(spaceData) }).pop();
                    if (foundSpace) {
                        weavy.debug("Populating space data", spaceData.id);
                        foundSpace.data = spaceData;
                        foundSpace.configure();
                    }
                })
            }

            // Do a script version mismatch check
            if (Weavy.version !== weavy.data.version) {
                weavy.error("Weavy client/server version mismatch! \nclient: " + Weavy.version + " \nserver: " + weavy.data.version);
            }

            if (weavy.isLoaded === false) {
                initRoot.call(weavy);

                /**
                    * Event triggered when weavy is building up the DOM elements.
                    * 
                    * Use this event to build all your elements and attach them to weavy.
                    * At this point you may safely assume that weavy.nodes.container is built.
                    * 
                    * Good practice is to build all elements in the build event and store them as properties on weavy.
                    * Then you can attach them to other Elements in the after:build event.
                    * This ensures that all Elements are built before they are attached to each other.
                    *
                    * If you have dependencies to Elements built by plugins you should also check that they actually exist before attaching to them.
                    *
                    * Often it's a good idea to check if the user is signed-in using {@link Weavy#isAuthenticated} unless you're building something that doesn't require a signed in user.
                    *
                    * @example
                    * weavy.on("build", function(e, root) {
                    *     if (weavy.authentication.isAuthorized()) {
                    *         weavy.nodes.myElement = document.createElement("DIV");
                    *     }
                    * });
                    * 
                    * weavy.on("after:build", function(e, root) {
                    *     if (weavy.authentication.isAuthorized()) {
                    *         if (weavy.nodes.dock) {
                    *             weavy.nodes.dock.appendChild(weavy.nodes.myElement);
                    *         }
                    *     }
                    * })
                    *
                    * @category events
                    * @event Weavy#build
                    */

                weavy.isLoaded = true;
                weavy.triggerEvent("build", { container: weavy.nodes.container, overlay: weavy.nodes.overlay });


                /**
                    * Event triggered when weavy has initialized, connected to the server and recieved and processed options, and built all components.
                    * Use this event to do stuff when everything is loaded.
                    * 
                    * Often it's a good idea to check if the user is signed-in using {@link Weavy#isAuthenticated} unless you're building something that doesn't require a signed in user.
                    * 
                    * @example
                    * weavy.on("load", function() {
                    *     if (weavy.authentication.isAuthorized()) {
                    *         weavy.alert("Widget successfully loaded");
                    *     }
                    * });
                    * 
                    * @category events
                    * @event Weavy#load
                    */
                weavy.triggerEvent("load");
            }

            weavy.isLoading = false;
            weavy.triggerEvent("processed:load");


        });

        // NAVIGATION
        weavy.navigation = new WeavyNavigation(weavy);

        // RUN PLUGINS

        /**
         * All enabled plugins are available in the plugin list. Anything exposed by the plugin is accessible here. 
         * You may use this to check if a plugin is enabled and active.
         * 
         * Set plugin options and enable/disable plugins using {@link Weavy#options}.
         * 
         * @example
         * if (weavy.plugins.alert) {
         *   weavy.plugins.alert.alert("Alert plugin is enabled");
         * }
         * 
         * @category plugins
         * @type {Object.<string, plugin>}
         */
        weavy.plugins = {};

        var _unsortedDependencies = {};
        var _sortedDependencies = [];
        var _checkedDependencies = [];

        function sortByDependencies(pluginName) {
            if (!pluginName) {
                for (plugin in _unsortedDependencies) {
                    sortByDependencies(plugin);
                }
            } else {
                if (Object.prototype.hasOwnProperty.call(_unsortedDependencies, pluginName)) {
                    var plugin = _unsortedDependencies[pluginName];
                    if (plugin.dependencies.length) {
                        plugin.dependencies.forEach(function (dep) {
                            // Check if plugin is enabled
                            if (typeof Weavy.plugins[dep] !== "function") {
                                weavy.error("plugin dependency needed by " + pluginName + " is not loaded/registered:", dep);
                            } else if (!(weavy.options.includePlugins && weavy.options.plugins[dep] !== false || !weavy.options.includePlugins && weavy.options.plugins[dep])) {
                                weavy.error("plugin dependency needed by " + pluginName + " is disabled:", dep);
                            }

                            if (_checkedDependencies.indexOf(dep) === -1) {
                                _checkedDependencies.push(dep);
                                sortByDependencies(dep);
                            } else {
                                weavy.error("You have circular Weavy plugin dependencies:", pluginName, dep);
                            }
                        });
                    }

                    if (Object.prototype.hasOwnProperty.call(_unsortedDependencies, pluginName)) {
                        _sortedDependencies.push(_unsortedDependencies[pluginName]);
                        delete _unsortedDependencies[pluginName];
                        _checkedDependencies = [];
                        return true;
                    }
                }
            }

            return false;
        }

        // Disable all plugins by setting plugin option to false
        if (weavy.options.plugins !== false) {
            weavy.options.plugins = weavy.options.plugins || {};


            for (plugin in Weavy.plugins) {
                if (typeof Weavy.plugins[plugin] === "function") {

                    // Disable individual plugins by setting plugin options to false
                    if (weavy.options.includePlugins && weavy.options.plugins[plugin] !== false || !weavy.options.includePlugins && weavy.options.plugins[plugin]) {
                        _unsortedDependencies[plugin] = { name: plugin, dependencies: $.isArray(Weavy.plugins[plugin].dependencies) ? Weavy.plugins[plugin].dependencies : [] };
                    }
                }
            }

            // Sort by dependencies
            sortByDependencies();

            for (var sortedPlugin in _sortedDependencies) {
                var plugin = _sortedDependencies[sortedPlugin].name;

                weavy.debug("Running Weavy plugin:", plugin);

                // Extend plugin options
                weavy.options.plugins[plugin] = weavy.extendDefaults(Weavy.plugins[plugin].defaults, $.isPlainObject(weavy.options.plugins[plugin]) ? weavy.options.plugins[plugin] : {}, true);

                // Run the plugin
                weavy.plugins[plugin] = Weavy.plugins[plugin].call(weavy, weavy.options.plugins[plugin]) || true;
            }

        }

        // INIT
        if (weavy.options.init === true) {
            weavy.init();
        }
    }

    // PROTOTYPE EXTENDING

    /**
     * Option preset configurations. Use these for simple configurations of common options. You may add your own presets also. 
     * The presets may be merged with custom options when you create a new Weavy, since the contructor accepts multiple option sets. 
     * 
     * @example
     * // Load the minimal weavy core without any additional plugins.
     * var weavy = new Weavy(Weavy.presets.core, { url: "https://myweavysite.com" });
     * 
     * @category options
     * @type {Object}
     * @property {Weavy#options} Weavy.presets.noplugins - Disable all plugins.
     * @property {Weavy#options} Weavy.presets.core - Enable all core plugins only.
     */
    Weavy.presets = {
        noplugins: {
            includePlugins: false
        },
        core: {
            includePlugins: false,
            plugins: {
                alert: true,
                filebrowser: true,
                preview: true,
                theme: true
            }
        }
    };

    /**
     * Default options. These options are general for all Weavy instances and may be overridden in {@link Weavy#options}. You may add any general options you like here.
     * 
     * @example
     * // Defaults
     * Weavy.defaults = {
     *     container: null,
     *     className: "",
     *     https: "adaptive",
     *     init: true,
     *     isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
     *     includePlugins: true,
     *     overlay: null,
     *     url: "/"
     * };
     * 
     * // Set a general url to connect all weavy instances to
     * Weavy.defaults.url = "https://myweavysite.com";
     * var weavy = new Weavy();
     *
     * @category options
     * @type {Object}
     * @property {Element} [container] - Container where weavy should be placed. If no Element is provided, a &lt;section&gt; is created next to the &lt;body&gt;-element.
     * @property {string} [className=weavy-default] - Additional classNames added to weavy.
     * @property {string} [https=adaptive] - How to enforce https-links. <br>• **force** -  makes all urls https.<br>• **adaptive** -  enforces https if the calling site uses https.<br>• **default** - makes no change.
     * @property {boolean} [init=true] - Should weavy initialize automatically.
     * @property {boolean} [isMobile] - Indicates if the browser is mobile. Defaults to the RegExp expression <code>/iPhone&#124;iPad&#124;iPod&#124;Android/i.test(navigator.userAgent)</code>
     * @property {boolean} [includePlugins=true] - Whether all registered plugins should be enabled by default. If false, then each plugin needs to be enabled in plugin-options.
     * @property {boolean} [preload] - Start automatic preloading after load
     * @property {string} url - The URL to the Weavy-installation to connect to.
     */
    Weavy.defaults = {
        container: null,
        https: "adaptive", // force, adaptive or default 
        init: true,
        isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent), // Review?
        includePlugins: true,
        preload: true,
        url: "/"
    };


    /**
     * Placeholder for registering plugins. Plugins must be registered and available here to be accessible and initialized in the Weavy instance. Register any plugins after you have loaded weavy.js and before you create a new Weavy instance.
     * @type {Object.<string, plugin>}
     */
    Weavy.plugins = {};

    /**
     * Id list of all created instances.
     * @name Weavy.instances
     * @type {string[]}
     */
    Object.defineProperty(Weavy, 'instances', {
        get: function () { return _weavyIds.slice(); },
        configurable: false
    });


    // PROTOTYPE METHODS

    /**
     * Method for extending options. It merges together options. If the recursive setting is applied it will merge any plain object children. Note that Arrays are treated as data and not as tree structure when merging. 
     * 
     * The original options passed are left untouched. {@link Weavy.httpsUrl} settings is applied to all url options.
     * 
     * @category options
     * @param {Object} source - Original options.
     * @param {Object} properties - Merged options that will replace options from the source.
     * @param {boolean} [recursive=false] True will merge any sub-objects of the options recursively. Otherwise sub-objects are treated as data.
     * @returns {Object} A new object containing the merged options.
     */
    Weavy.prototype.extendDefaults = function (source, properties, recursive) {
        source = source || {};
        properties = properties || {};

        var property;
        var https = properties.https || source.https || this.options.https || Weavy.defaults.https || "nochange";

        // Make a copy
        var copy = {};
        for (property in source) {
            if (Object.prototype.hasOwnProperty.call(source, property)) {
                copy[property] = source[property];
            }
        }

        // Apply properties to copy
        for (property in properties) {
            if (Object.prototype.hasOwnProperty.call(properties, property)) {
                if (recursive && copy[property] && $.isPlainObject(copy[property]) && $.isPlainObject(properties[property])) {
                    copy[property] = this.extendDefaults(copy[property], properties[property], recursive);
                } else {
                    copy[property] = this.httpsUrl(properties[property], null, https);
                }
            }
        }
        return copy;
    };


    /**
     * Applies https enforcement to an url. Optionally adds a baseUrl to relative urls.
     * 
     * @category options
     * @param {string} url - The url to process
     * @param {string} [baseUrl] - Url to preprend to relative urls. Ie. `weavy.options.url`
     * @param {string} [https] - How to treat http enforcement for the url. Default to settings from {@link Weavy#options}. <br> • **enforce** - makes all urls https.<br> • **adaptive** - enforces https if the calling site uses https.<br> • **nochange** - makes no change.
     * @returns {string} url
     */
    Weavy.prototype.httpsUrl = function (url, baseUrl, https) {
        https = https || this.options.https || Weavy.defaults.https || "nochange";
        if (typeof url === "string" && https !== "nochange") {
            // Check baseUrl and url protocol
            if (baseUrl && !/^[0-9a-zA-Z+\-.]*:/.test(url)) {
                // Remove beginning slash
                if (url.indexOf("/") === 0) {
                    url = url.substr(1);
                }
                // Add trailing slash
                if (baseUrl.lastIndexOf("/") !== baseUrl.length - 1) {
                    baseUrl += "/";
                }
                url = baseUrl + url;
            }

            // Check protocol
            if (https === "enforce") {
                url = url.replace(/^http:/, "https:");
            } else if (https === "adaptive") {
                url = url.replace(/^http:/, window.location.protocol);
            }
        }
        return url;
    };

    return Weavy;

}));

/**
 * @external Promise
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
 */

/**
 * @external jqXHR
 * @see http://api.jquery.com/jQuery.ajax/#jqXHR
 */

/**
 * @external jqAjaxSettings
 * @see http://api.jquery.com/jquery.ajax/#jQuery-ajax-settings
 */
;
/* eslint-env commonjs, amd */

// UMD based on https://github.com/umdjs/umd/blob/master/templates/returnExports.js
// TODO: move to ES6 and transpiler

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            'jquery',
            'weavy'
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(
            require('jquery'),
            require('weavy')
        );
    } else {
        // Browser globals (root is window)
        if (typeof Weavy === 'undefined' || !Weavy.plugins) {
            throw new Error("Weavy must be loaded before registering plugin");
        }

        factory(jQuery, Weavy);
    }
}(typeof self !== 'undefined' ? self : this, function ($, Weavy) {

    /**
     * Plugin for displaying alert messages.
     * 
     * @mixin AlertPlugin
     * @returns {Weavy.plugins.alert}
     * @property {AlertPlugin#alert} .alert()
     * @typicalname weavy
     */
    var AlertPlugin = function (options) {
        /** 
         * Reference to this instance
         * @lends AlertPlugin#
         */
        var weavy = this;
        var _addMessages = [];

        function displayMessage(message, sticky) {
            if (!sticky) {
                weavy.timeout(5000).then(function () {
                    message.classList.remove("in");
                });
                weavy.timeout(5200).then(function () {
                    $(message).remove();
                });
            }
            weavy.timeout(1).then(function () {
                message.classList.add("in");
            });
            weavy.nodes.overlay.appendChild(message)
        }

        /**
         * Displays an alert.
         * 
         * @example
         * weavy.alert("Weavy is awesome!", true);
         * 
         * @param {string} message - The message to display
         * @param {boolean} [sticky=false] - Should the alert be sticky and not dismissable?
         */
        weavy.alert = function (message, sticky) {
            var alertMessage = document.createElement("div");
            alertMessage.className = options.className;
            alertMessage.innerHTML = message;

            if (weavy.nodes.overlay) {
                displayMessage(alertMessage, sticky);
            } else {
                _addMessages.push([alertMessage, sticky]);
            }
            weavy.log("Alert\n" + alertMessage.innerText);
        }

        weavy.on("after:build", function () {
            _addMessages.forEach(function (alertMessage) {
                displayMessage.apply(weavy, alertMessage);
            });
            _addMessages = [];
        });

        // Exports
        return { alert: weavy.alert }
    };

    /**
     * Default plugin options
     * 
     * @example
     * Weavy.plugins.alert.defaults = {
     *     className: "weavy-alert-message fade in"
     * };
     * 
     * @name defaults
     * @memberof AlertPlugin
     * @type {Object}
     * @property {string} [className=weavy-alert-message fade in] - Default classes for the alerts
     */
    AlertPlugin.defaults = {
        className: "weavy-alert-message fade"
    };

    // Register and return plugin
    console.debug("Registering Weavy plugin: alert");
    return Weavy.plugins.alert = AlertPlugin;

}));
/* eslint-env commonjs, amd */

// UMD based on https://github.com/umdjs/umd/blob/master/templates/returnExports.js
// TODO: move to ES6 and transpiler

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            'jquery',
            'weavy'
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(
            require('jquery'),
            require('weavy')
        );
    } else {
        // Browser globals (root is window)
        if (typeof Weavy === 'undefined' || !Weavy.plugins) {
            throw new Error("Weavy must be loaded before registering plugin");
        }

        factory(jQuery, Weavy);
    }
}(typeof self !== 'undefined' ? self : this, function ($, Weavy) {

    /**
     * Filepicker plugin for attaching from Google, O365, Dropbox etc.
     * It listens to `request:origin` messages from frames and responds to the source with a `origin` message containing the `window.location.origin`.
     * 
     * _This plugin has no exposed properties or options._
     * 
     * @mixin FileBrowserPlugin
     * @returns {Weavy.plugins.filebrowser}
     * @typicalname weavy
     */
    var FileBrowserPlugin = function (options) {
        /** 
         *  Reference to this instance
         *  @lends FileBrowserPlugin#
         */
        var weavy = this;


        // TODO: This belongs in wvy.postal or wvy.browser instead 
        weavy.on(wvy.postal, "request:origin", weavy.getId(), function (e) {
            wvy.postal.postToSource(e, { name: 'origin', url: window.location.origin });
        });

        // Exports
        return {}
    };

    /**
     * Default plugin options
     * 
     * @example
     * Weavy.plugins.filebrowser.defaults = {
     * };
     * 
     * @ignore
     * @name defaults
     * @memberof FileBrowserPlugin
     * @type {Object}
     */
    FileBrowserPlugin.defaults = {
    };

    // Register and return plugin
    console.debug("Registering Weavy plugin: filebrowser");
    return Weavy.plugins.filebrowser = FileBrowserPlugin;
}));
/* eslint-env commonjs, amd */

// UMD based on https://github.com/umdjs/umd/blob/master/templates/returnExports.js
// TODO: move to ES6 and transpiler

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            'jquery',
            'weavy'
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(
            require('jquery'),
            require('weavy')
        );
    } else {
        // Browser globals (root is window)
        if (typeof Weavy === 'undefined' || !Weavy.plugins) {
            throw new Error("Weavy must be loaded before registering plugin");
        }

        factory(jQuery, Weavy);
    }
}(typeof self !== 'undefined' ? self : this, function ($, Weavy) {

    /**
     * Displaying photoswipe and pdfs in the full browser window.
     * 
     * @mixin PreviewPlugin
     * @returns {Weavy.plugins.preview}
     * @typicalname weavy
     */
    var PreviewPlugin = function (options) {
        /** 
         *  Reference to this instance
         *  @lends PreviewPlugin#
         */
        var weavy = this;

        weavy.on(wvy.postal, "preview-close", weavy.getId(), function (e, message) {
            weavy.nodes.previewPanel.close();
        });

        // DOCUMENT PREVIEW
        weavy.on(wvy.postal, "preview-open", weavy.getId(), function (e, message) {
            weavy.log("opening preview", message);
            weavy.nodes.previewPanel.open().then(function () {
                weavy.nodes.previewPanel.postMessage({ name: "preview-options", options: message.options });
            });
            weavy.one(wvy.postal, "request:preview-options", weavy.getId(), function (e) {
                weavy.nodes.previewPanel.postMessage({ name: "preview-options", options: message.options });
            })
        });

        // IMAGE PREVIEW
        weavy.on(wvy.postal, "photoswipe-open", weavy.getId(), function (e, message) {
            weavy.log("opening photoswipe", message);
            weavy.nodes.previewPanel.open().then(function () {
                weavy.nodes.previewPanel.postMessage({ name: "photoswipe-options", options: message.options });
            });
            weavy.one(wvy.postal, "request:photoswipe-options", weavy.getId(), function (e) {
                weavy.nodes.previewPanel.postMessage({ name: "photoswipe-options", options: message.options });
            })
        });

        weavy.on("build", function (e, build) {
            if (!weavy.nodes.previewPanel) {
                weavy.nodes.previewPanel = weavy.nodes.panels.preview.addPanel(options.frameName, "/e/preview", { controls: { close: true }, persistent: true, preload: true });
                weavy.on("panel-close", function (e, closePanel) {
                    if (closePanel.panelId === options.frameName) {
                        weavy.log("preview panel close");
                    }
                });
            }
        })

        // Exports (not required)
        return {}
    };

    /**
     * Default plugin options
     * 
     * @example
     * Weavy.plugins.preview.defaults = {
     *     frameName: "preview"
     * };
     * 
     * @name defaults
     * @memberof PreviewPlugin
     * @type {Object}
     */
    PreviewPlugin.defaults = {
        frameName: "preview"
    };

    console.debug("Registering Weavy plugin: preview");

    return Weavy.plugins.preview = PreviewPlugin
}));
/* eslint-env commonjs, amd */

// UMD based on https://github.com/umdjs/umd/blob/master/templates/returnExports.js
// TODO: move to ES6 and transpiler

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            'jquery',
            'weavy'
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(
            require('jquery'),
            require('weavy')
        );
    } else {
        // Browser globals (root is window)
        if (typeof Weavy === 'undefined' || !Weavy.plugins) {
            throw new Error("Weavy must be loaded before registering plugin");
        }

        factory(jQuery, Weavy);
    }
}(typeof self !== 'undefined' ? self : this, function ($, Weavy) {

    /**
     * Plugin for sign-in panel.
     * 
     * @mixin AuthenticationPanelPlugin
     * @returns {Weavy.plugins.authenticationPanel}
     * @typicalname weavy
     */
    var AuthenticationPanelPlugin = function (options) {
        /**
         * The nodes placeholder in [Weavy]{@link Weavy#nodes}
         * @instance
         * @member nodes
         * @memberof AuthenticationPanelPlugin
         * @extends Weavy#nodes
         * @typicalname weavy.nodes
         */

        /**
         *  Reference to this instance
         *  @lends AuthenticationPanelPlugin#
         */
        var weavy = this;

        var whenSignedIn = $.Deferred();
        var isSigningIn = false;

        /**
         * The url to the sign in page
         * 
         * @category properties
         * @type {url}
         */
        var signInUrl = weavy.httpsUrl("sign-in?path=" + options.redirect, weavy.options.url);


        /**
         * Panel displaying the authentication page
         * 
         * @alias AuthenticationPanelPlugin#nodes#authenticationPanel
         * @type {?Element}
         * @created Client event: {@link Weavy#event:build}
         */
        weavy.nodes.authenticationPanel = null;

        /**
         * Open the sign-in page. An authentication attempt is started if credentials are provided.
         * 
         * @example
         * // Open the sign in panel and wait for the user to complete authentication
         * weavy.authentication.authenticationPanel.signIn().then(function() {
         *     weavy.log("User has signed in");
         * }).catch(function() {
         *     weavy.warn("User sign-in failed");
         * });
         * @returns {external:Promise}
         * @resolves - On successful sign-in
         * @rejects - On authentication error if [username] and [password] is provided
         * @fires Weavy#signed-in
         * @fires Weavy#authentication-error
         */
        function signIn() {
            weavy.log("signing in");

            if (isSigningIn || weavy.authentication.isAuthorized()) {
                weavy.log("user already " + (isSigningIn ? "signing" : "signed") + " in, moving on");
                return whenSignedIn.promise();
            }

            isSigningIn = true;

            weavy.whenLoaded().then(function () {
                if (weavy.nodes.authenticationPanel) {
                    weavy.log("signIn opening authentication panel")
                    weavy.nodes.authenticationPanel.open(signInUrl);
                }
            });

            // return promise
            return whenSignedIn.promise();
        }

        weavy.on("user", function (e, auth) {
            if (auth.authorized) {
                isSigningIn = false;
                whenSignedIn.resolve(auth);
            }
        });

        weavy.on("build", function () {
            if (!weavy.nodes.authenticationPanel) {
                weavy.nodes.authenticationPanel = weavy.nodes.panels.drawer.addPanel(options.frameName, null, { controls: { close: true }, persistent: true, preload: false });
                weavy.on("panel-close", function (e, closePanel) {
                    if (closePanel.panelId === options.frameName) {
                        weavy.log("signIn authentication panel close")
                        isSigningIn = false;
                    }
                });
            }
        });

        // POST-MESSAGE LISTENERS

        weavy.on(wvy.postal, "signing-in", weavy.getId(), function (e) {
            var message = e.data;
            /**
             * Event triggered when signing in process has begun. The user is still not authenticated. The authentication may result in {@link Weavy#event:signed-in} or {@link Weavy#event:authentication-error}.
             * This event may be triggered from anywhere, not only the Weavy instance.
             * 
             * @category events
             * @event Weavy#signing-in
             * @returns {Object}
             * @property {boolean} isLocal - Is the origin of the event from this weavy instance
             */
            weavy.timeout(0).then(weavy.triggerEvent.bind(weavy, "signing-in", { isLocal: typeof e.source !== "undefined" && (message.weavyId === true || message.weavyId === weavy.getId()) }));
        });


        weavy.on(wvy.postal, "authentication-error", weavy.getId(), function (e) {
            weavy.nodes.authenticationPanel.open();

            /**
             * Event triggered when a sign-in attempt was unsuccessful.
             * This event may be triggered from anywhere, not only the Weavy instance.
             * 
             * @category events
             * @event Weavy#authentication-error
             */
            weavy.timeout(0).then(weavy.triggerEvent.bind(weavy, "authentication-error", { method: "panel", status: 401, message: "Unauthorized" }));
        });

        // EVENT LISTENERS

        weavy.on("signing-in", function () {
            isSigningIn = true;

            if (!weavy.nodes.authenticationPanel || !weavy.nodes.panels || !weavy.nodes.panels.drawer) {
                return;
            }

            if (weavy.nodes.authenticationPanel) {
                weavy.nodes.authenticationPanel.close();
            }
        });

        weavy.on("signed-in", function (e, auth) {
            isSigningIn = false;
            if (weavy.nodes.authenticationPanel) {
                weavy.nodes.authenticationPanel.close();
            }
            whenSignedIn.resolve(auth.user);
        });

        weavy.on("clear-user signed-out", function (e, auth) {
            isSigningIn = false;
            whenSignedIn.reject();
        });

        weavy.on("authentication-error user-error", function (e, error) {
            if (error === undefined || error.method === undefined || error.method !== "panel") {
                isSigningIn = false;
                whenSignedIn.reject();
            }
        });

        weavy.on("signed-out", function (e, auth) {
            whenSignedIn = $.Deferred();
        });

        var authenticationExports = {
            signIn: signIn,
            isSigningIn: function () { return isSigningIn },
            whenSignedIn: function () {
                return whenSignedIn.promise();
            }
        };

        weavy.authentication.authenticationPanel = authenticationExports;

        // Exports
        return authenticationExports;
    };

    /**
     * Default plugin options
     *
     * @example
     * Weavy.plugins.authenticationPanel.defaults = {
     *     redirect: '/notify',
     *     frameClassName: "",
     *     frameName: "authentication"
     * };
     *
     * @name defaults
     * @memberof AuthenticationPanelPlugin
     * @type {Object}
     * @property {string} redirect=/notify - URL to redirect to after signing in or out
     * @property {string} frameName=authentication - Name used for the authentication panel
     */
    AuthenticationPanelPlugin.defaults = {
        redirect: '/notify',
        frameName: "authentication"
    };

    /**
     * Non-optional dependencies.
     * 
     * @name dependencies
     * @memberof AuthenticationPanelPlugin
     * @type {string[]}
     */
    AuthenticationPanelPlugin.dependencies = [];

    // Register and return plugin
    console.debug("Registering Weavy plugin: authenticationPanel");
    return Weavy.plugins.authenticationPanel = AuthenticationPanelPlugin;
}));

/**
 * @external Promise
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
 */
;
/* eslint-env commonjs, amd */

// UMD based on https://github.com/umdjs/umd/blob/master/templates/returnExports.js
// TODO: move to ES6 and transpiler

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            'jquery',
            'weavy'
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory(
            require('jquery'),
            require('weavy')
        );
    } else {
        // Browser globals (root is window)
        if (typeof Weavy === 'undefined' || !Weavy.plugins) {
            throw new Error("Weavy must be loaded before registering plugin");
        }

        factory(jQuery, Weavy);
    }
}(typeof self !== 'undefined' ? self : this, function ($, Weavy) {

    /**
     * Inject additional styles into the sealed weavy shadow dom. You may define styles by either setting weavy plugin options or by injecting them via {@link theme#addStyles}
     * 
     * @example
     * ```html
     * <style id="weavyStyleOverrides" media="not all">
     *     // media="not all" keeps it from beeing applied on the page
     *     ...
     * </style>
     * <script>
     *     weavy.plugins.theme.createStyleSheet(weavy.nodes.container, ".weavy-panel{ background: red; }");
     *
     *     weavy.plugins.theme.addCss(weavy.nodes.container, document.getElementById("weavyStyleOverrides").textContent);
     * </script>
     * ```
     * 
     * @mixin ThemePlugin
     * @returns {Weavy.plugins.theme}
     * @property {function} .createStyleSheet() - {@link ThemePlugin#createStyleSheet}
     * @property {function} .addCss() - {@link ThemePlugin#addCss}
     * @typicalname weavy
     */
    var ThemePlugin = function (options) {
         /** 
         *  Reference to this instance
         *  @lends ThemePlugin#
         */
        var weavy = this;

        var supportsShadowDOM = !!HTMLElement.prototype.attachShadow;

        /**
         * Creates a style sheet for weavy and adds any styles
         * together with styles provided in options or by using {@link ThemePlugin#addCss}.
         * This function is automatically called on [before:build]{@link Weavy#event:build}
         * 
         * @param {HTMLElement} root - The dom node where the stylesheet should be attached.
         * @param {string} css - CSS for the stylesheet.
         */
        function createStyleSheet(root, css) {
            if (root.weavyStyles) {
                if (root.weavyStyles.styleSheet) {
                    root.weavyStyles.styleSheet.cssText = css;
                } else {
                    root.weavyStyles.removeChild(root.weavyStyles.firstChild);
                    root.weavyStyles.appendChild(document.createTextNode(css));
                }
            } else {
                root.weavyStyles = document.createElement("style");
                root.weavyStyles.type = "text/css";
                root.weavyStyles.styleSheet ? root.weavyStyles.styleSheet.cssText = css : root.weavyStyles.appendChild(document.createTextNode(css));

                if (supportsShadowDOM) {
                    root.appendChild(root.weavyStyles);
                } else {
                    var styleId = weavy.getId("weavy-styles");
                    if (!document.getElementById(styleId)) {
                        root.weavyStyles.id = styleId;
                        document.getElementsByTagName("head")[0].appendChild(root.weavyStyles);
                    }
                }
            }

        }

        /**
         * Add styles to an existing weavy stylesheet.
         * 
         * @param {HTMLElement} root - The root containing the stylesheet
         * @param {string} css - The styles to apply. Full css including selectors etc may be used.
         */
        function addCss (root, css) {
            css += "\n";

            if (root.weavyStyles) {
                if (root.weavyStyles.styleSheet) {
                    root.weavyStyles.styleSheet.cssText += css;
                } else {
                    root.weavyStyles.appendChild(document.createTextNode(css));
                }
            }
        }

        weavy.on("create-root", function (e, createRoot) {
            if (weavy.data && weavy.data.plugins.theme) {
                var data = weavy.data.plugins.theme;

                // add styles
                createStyleSheet(createRoot.root, data.clientCss);
            }
        });

        weavy.on("destroy", function (e, destroy) {
            $("#" + weavy.getId("weavy-styles")).remove();
        });

        // Exports
        return {
            addCss: addCss,
            createStyleSheet: createStyleSheet
        };
    };

    /**
     * Default plugin options
     * 
     * @example
     * Weavy.plugins.theme.defaults = {
     * };
     * @name defaults
     * @memberof ThemePlugin
     * @type {Object}
     */
    ThemePlugin.defaults = {
    };

    console.debug("Registering Weavy plugin: theme");
    return Weavy.plugins.theme = ThemePlugin;
}));
Weavy.version = "7.3.1+weavy.1fb84797d"; Weavy.defaults.url = "https://dave-test.weavycloud.com/"; 