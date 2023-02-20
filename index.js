"use strict";
exports.__esModule = true;
exports.Logger = exports.console2Logger = exports.LogLevel = void 0;
var bunyan = require("bunyan");
var bunyanDbg = require("bunyan-debug-stream");
var colorsUtil = require("colors/safe");
var LogLevel;
(function (LogLevel) {
    // levels set same as bunyan levels
    LogLevel[LogLevel["Fatal"] = 60] = "Fatal";
    LogLevel[LogLevel["Error"] = 50] = "Error";
    LogLevel[LogLevel["Warn"] = 40] = "Warn";
    LogLevel[LogLevel["Info"] = 30] = "Info";
    LogLevel[LogLevel["Debug"] = 20] = "Debug";
    LogLevel[LogLevel["Trace"] = 10] = "Trace";
})(LogLevel = exports.LogLevel || (exports.LogLevel = {}));
;
var origConsoleMethods = null;
var origLogger = null;
var consoleMethods = ["log", "warn", "error"];
function console2Logger(logger) {
    origLogger = logger;
    origConsoleMethods = {};
    consoleMethods.forEach(function (method) {
        origConsoleMethods[method] = console[method];
    });
    consoleMethods.forEach(function (method) {
        console[method] = function () {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            if (args.length === 0) {
                args = [''];
            }
            switch (method) {
                case 'log':
                    logger.info.apply(logger, args);
                    break;
                case 'warn':
                    logger.warn.apply(logger, args);
                    break;
                case 'error':
                    logger.error.apply(logger, args);
                    break;
            }
        };
    });
}
exports.console2Logger = console2Logger;
function revertConsoleRedirect() {
    if (origConsoleMethods == null) {
        return;
    }
    consoleMethods.forEach(function (method) {
        console[method] = origConsoleMethods[method];
    });
}
function restoreConsoleRedirect() {
    if (origLogger == null) {
        return;
    }
    console2Logger(origLogger);
}
var Logger = /** @class */ (function () {
    function Logger(name, filepath, basepath, options) {
        if (!options) {
            options = {};
        }
        this.name = name;
        this.filepath = filepath;
        this.basepath = basepath;
        this.options = options;
        this.bunyanLog = null;
    }
    //
    // Init underlying Bunyan logger
    //
    Logger.prototype.init = function (bunyanLogger) {
        if (bunyanLogger !== undefined) {
            this.bunyanLog = bunyanLogger;
        }
        else {
            var options = JSON.parse(JSON.stringify(this.options));
            //
            // Set basic options
            //
            options.name = this.name;
            //
            // Set streams
            //
            var level = void 0;
            options.streams = [];
            if (this.filepath) {
                level = this.levelToStr(options.fileLevel ? options.fileLevel : LogLevel.Info);
                if (options.fileLevel) {
                    delete options.fileLevel;
                }
                options.streams.push({
                    path: this.filepath,
                    level: level
                });
                if (options.fileLevel) {
                    delete options.fileLevel;
                }
            }
            if (!options.consoleOff) {
                var level_1 = this.levelToStr(options.consoleLevel ? options.consoleLevel : LogLevel.Info);
                if (options.consoleLevel) {
                    delete options.consoleLevel;
                }
                options.streams.push({
                    level: level_1,
                    type: 'raw',
                    stream: bunyanDbg({
                        basepath: this.basepath,
                        forceColor: false,
                        prefixers: {
                            // Add (child) module to line, if present 
                            'mod': function (mod) {
                                return mod ? mod : null;
                            },
                            'req': function (req, options) {
                                var colorsToApply = options.debugStream._colors[options.entry.level];
                                var len = req.contentLen ? req.contentLen + 'B' : '-';
                                var statusCode = options.entry && options.entry.res ? options.entry.res.statusCode : '?';
                                var userId = req.userId ? req.userId : '-';
                                var value = req.method + " " + len + " [" + statusCode + "] " +
                                    ("user " + userId + "/" + req.userRole + " ") +
                                    (req.site + " ") +
                                    (req.url + " ") +
                                    ("(from " + req.remoteAddress + "; ") + // ${req.remotePort} not reliable thru proxy?
                                    ("ref " + req.referer + "; ") +
                                    ("agent " + req.userAgent + ")");
                                colorsToApply.map(function (c) {
                                    // typically just one color, but could have other styling
                                    value = colorsUtil[c](value);
                                });
                                return {
                                    value: value,
                                    replaceMessage: true,
                                    consumed: ['req', 'res', 'method', 'url', 'host', 'user']
                                };
                            }
                        }
                        // out        : process.stdout ... stderr?
                    })
                });
            }
            else {
                delete options.consoleOff;
            }
            //
            // Init serializers (just the standard one for now, for errors)
            //
            options.serializers = bunyan.stdSerializers;
            // Overwrite with our own for request
            // see ~/gv/node_modules/gv-logger/node_modules/bunyan/lib/bunyan.js
            options['serializers']['req'] = function (req) {
                if (!req) {
                    return req;
                }
                else {
                    var conn = req.connection != null ? req.connection : {};
                    var lcls = req.locals != null ? req.locals : {};
                    var hdrs = req.headers != null ? req.headers : {};
                    return {
                        method: req.method,
                        site: lcls.subdomain,
                        // Accept `req.originalUrl` for expressjs usage.
                        // https://expressjs.com/en/api.html#req.originalUrl
                        url: req.originalUrl || req.url,
                        userAgent: hdrs['user-agent'],
                        referer: hdrs.referer,
                        remoteAddress: req.ip,
                        contentLen: hdrs['content-length'],
                        // remotePort: conn.remotePort,  //  not reliable thru proxy?
                        userId: req.user != null ? req.user.user_id : null,
                        userRole: req.userRole != null ? req.userRole : null
                    };
                }
            };
            options['serializers']['res'] = function (res) {
                if (!res) {
                    return res;
                }
                else {
                    return {
                        statusCode: res.statusCode
                    };
                }
            };
            // Create logger
            this.bunyanLog = bunyan.createLogger(options);
        }
        // Handle logging errors
        this.bunyanLog.on('error', this.handleStreamError.bind(this));
    };
    //
    // Creating a child logger
    //
    Logger.prototype.childLogger = function (moduleName, options) {
        if (options == null) {
            options = this.options;
        }
        else {
            var optProps = Object.keys(this.options);
            for (var i = 0; i < optProps.length; i++) {
                if (options[optProps[i]] == null) {
                    options[optProps[i]] = this.options[optProps[i]];
                }
            }
        }
        var newBunyan = this.bunyanLog.child({ mod: moduleName });
        var newLogger = new Logger(this.name, this.filepath, this.basepath, options);
        newLogger.init(newBunyan);
        return newLogger;
    };
    //
    // core Bunyan logger, use this to pass into other libraries
    // that want a completely Bunyan-compatible logger
    //
    Logger.prototype.coreLogger = function () {
        return this.bunyanLog;
    };
    //
    // Logger for Express requests
    // Use like:
    //
    //    app.use(logger.express());
    // or    
    //    app.use(logger.express(/node_modules/, 'skip'));
    //
    Logger.prototype.express = function (regex, mode) {
        var reSkips = null;
        if (regex) {
            if (Array.isArray(regex)) {
                reSkips = regex;
            }
            else {
                reSkips = [regex];
            }
        }
        var msg = "GVLogger logging HTTP requests";
        if (reSkips) {
            msg += " with RegExp qualification(s): " + reSkips.map(function (x) { return x.toString(); }).join(';');
            if (mode) {
                msg += " => " + mode;
            }
        }
        this.info(msg);
        var _this = this;
        return function (req, res, next) {
            if (reSkips != null) {
                var matches = reSkips.some(function (re) { return req.url.match(re) !== null; });
                if (mode == 'skip') {
                    if (matches) {
                        return next();
                    }
                }
                else {
                    if (!matches) {
                        return next();
                    }
                }
            }
            var opts = { req: req, res: res };
            opts['time'] = (new Date()).toISOString();
            _this.bunyanLog.info(opts);
            next();
        };
    };
    //
    // Logging methods
    //
    Logger.prototype.trace = function (opts, msg) {
        var args = [];
        for (var _i = 2; _i < arguments.length; _i++) {
            args[_i - 2] = arguments[_i];
        }
        this.handleLog(opts, msg, args, 'trace');
    };
    Logger.prototype.debug = function (opts, msg) {
        var args = [];
        for (var _i = 2; _i < arguments.length; _i++) {
            args[_i - 2] = arguments[_i];
        }
        this.handleLog(opts, msg, args, 'debug');
    };
    Logger.prototype.info = function (opts, msg) {
        var args = [];
        for (var _i = 2; _i < arguments.length; _i++) {
            args[_i - 2] = arguments[_i];
        }
        this.handleLog(opts, msg, args, 'info');
    };
    Logger.prototype.warn = function (opts, msg) {
        var args = [];
        for (var _i = 2; _i < arguments.length; _i++) {
            args[_i - 2] = arguments[_i];
        }
        this.handleLog(opts, msg, args, 'warn');
    };
    // For a stack trace, issue error() and fatal() calls
    // (or other logger calls above)
    // with an Error object, either as the sole argument, or
    // as an 'err' property in the options.  I.e., either:
    //
    //   logger.error(new Error("bad stuff in processing"));
    //   logger.error({err : new Error("bad stuff")}, "bad instruction?");
    //
    Logger.prototype.error = function (opts, msg) {
        var args = [];
        for (var _i = 2; _i < arguments.length; _i++) {
            args[_i - 2] = arguments[_i];
        }
        // hopefully opts.err is set to the error object!
        this.handleLog(opts, msg, args, 'error');
    };
    Logger.prototype.fatal = function (opts, msg) {
        var args = [];
        for (var _i = 2; _i < arguments.length; _i++) {
            args[_i - 2] = arguments[_i];
        }
        // hopefully opts.err is set to the error object!
        this.handleLog(opts, msg, args, 'fatal');
    };
    //
    // private methods
    //
    Logger.prototype.handleStreamError = function (err, stream) {
        console.error("Logger, got an error in logging to a stream!", err, stream);
    };
    Logger.prototype.levelToStr = function (level) {
        switch (level) {
            case LogLevel.Fatal:
                return 'fatal';
            case LogLevel.Error:
                return 'error';
            case LogLevel.Warn:
                return 'warn';
            case LogLevel.Info:
                return 'info';
            case LogLevel.Debug:
                return 'debug';
            case LogLevel.Trace:
                return 'trace';
            default:
                return 'unknown';
        }
    };
    Logger.prototype.handleLog = function (opts, msg, args, logType) {
        var newOpts;
        revertConsoleRedirect();
        if (typeof opts === 'string') {
            if (msg) {
                args.unshift(msg);
            }
            msg = opts;
            newOpts = {};
        }
        else {
            newOpts = opts;
        }
        for (var j = 0; j < args.length; j++) {
            newOpts['arg' + (j + 1)] = args[j];
        }
        // If 'err' is one of the properties in opts, but is NOT an Error, 
        // then convert it to a string, and make it part of the message rather
        // than have it shown on a separate line as an 'arg'
        if (opts.err && (!(opts.err instanceof Error))) {
            if (typeof opts.err !== 'string') {
                try {
                    opts['err'] = JSON.stringify(opts.err);
                }
                catch (e) {
                    opts['err'] = opts.err + '';
                }
            }
        }
        if (typeof opts.err === 'string') {
            if (!msg) {
                msg = '';
            }
            else {
                msg += ': ';
            }
            msg += opts.err;
            delete opts.err;
        }
        var func = this.bunyanLog[logType].bind(this.bunyanLog);
        // Use ISO UTC timestamp
        newOpts['time'] = (new Date()).toISOString();
        var res;
        if (msg !== undefined) {
            res = func(newOpts, msg);
        }
        else {
            res = func(newOpts);
        }
        restoreConsoleRedirect();
        return res;
    };
    return Logger;
}());
exports.Logger = Logger;
