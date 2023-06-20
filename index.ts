import * as bunyan     from 'bunyan';

// import * as bunyanDbg  from 'bunyan-debug-stream';
const bunyanDbg = require('bunyan-debug-stream');

import * as colorsUtil from 'colors/safe';

export enum LogLevel {
    // levels set same as bunyan levels
    Fatal   = 60,
    Error   = 50,
    Warn    = 40,
    Info    = 30,
    Debug   = 20,
    Trace   = 10
};

let origConsoleMethods = null;
let origLogger         = null;

let consoleMethods     = ["log", "warn", "error"];

export function console2Logger(logger:any) {
    origLogger         = logger;
    origConsoleMethods = {};

    consoleMethods.forEach(function(method) {
        origConsoleMethods[method] = console[method];
    });

    consoleMethods.forEach(function(method) {
        console[method] = function(...args:any[]) {
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

function revertConsoleRedirect() {
    if (origConsoleMethods == null) {
        return;
    }
    consoleMethods.forEach(function(method) {
        console[method] = origConsoleMethods[method];
    });
}

function restoreConsoleRedirect() {
    if (origLogger == null) {
        return;
    }
    console2Logger(origLogger);
}


export class Logger {
    name      : string;  // server name
    filepath  : string;  // filepath to .json log file
    basepath  : string;  // set to __dirname at server root
    options   : any;     // options, passed through to Bunyan logger

    bunyanLog : any;

    constructor(name:string, filepath:string, basepath:string, options?:any) { 
        if (!options)       { options = {}; }

        this.name     = name;
        this.filepath = filepath;
        this.basepath = basepath;
        this.options  = options;

        this.bunyanLog = null;
    }

    //
    // Init underlying Bunyan logger
    //

    public init(bunyanLogger?:any) {
        if (bunyanLogger !== undefined) {
            this.bunyanLog = bunyanLogger;
        } else {
            let options = JSON.parse(JSON.stringify(this.options));

            //
            // Set basic options
            //

            options.name = this.name;

            //
            // Set streams
            //

	    let level;
            options.streams = [];

            if (this.filepath) {
	        level = this.levelToStr(options.fileLevel ? options.fileLevel : LogLevel.Info);
		if (options.fileLevel) {delete options.fileLevel;}

                options.streams.push({
                    path  : this.filepath,
                    level : level
                });

                if (options.fileLevel) { delete options.fileLevel; }
            }

            if (! options.consoleOff) {
	        let level = this.levelToStr(options.consoleLevel ? options.consoleLevel : LogLevel.Info);
		if (options.consoleLevel) {delete options.consoleLevel;}
                options.streams.push({
                    level  : level,
                    type   : 'raw',
                    stream : bunyanDbg.create({
                        basepath   : this.basepath,  
                        forceColor : false,
                        prefixers: {
                            // Add (child) module to line, if present 
                            'mod': function(mod) {
                                return mod ? mod : null;
                            },
                            'req' : function(req, options) {
                                let colorsToApply = options.debugStream._colors[options.entry.level];
                                let len = req.contentLen ? req.contentLen + 'B' : '-';
                                let statusCode = options.entry && options.entry.res ? options.entry.res.statusCode : '?';
                                let userId = req.userId ? req.userId  : '-';
                                
                                let value = 
                                    `${req.method} ${len} [${statusCode}] ` +
                                    `user ${userId}/${req.userRole} ` +
                                    `${req.site ? req.site : '??'} ` +
                                    `${req.url} ` +
                                    `(from ${req.remoteAddress}; ` +  // ${req.remotePort} not reliable thru proxy?
                                    `ref ${req.referer ? req.referer : '??'}; ` +
                                    `agent ${req.userAgent ? req.userAgent : '??'})`;

                                colorsToApply.map( c => {
                                    // typically just one color, but could have other styling
                                    value = colorsUtil[c](value);
                                });
                                
                                return {
                                    value : value,
                                    replaceMessage: true,
                                    consumed : ['req', 'res', 'method', 'url', 'host', 'user']
                                }
                            }
                        }

                        // out        : process.stdout ... stderr?
                    })
                });
            } else {
                delete options.consoleOff;
            }

            //
            // Init serializers (just the standard one for now, for errors)
            //

            options.serializers = bunyan.stdSerializers;

            // Overwrite with our own for request
            // see ~/gv/node_modules/gv-logger/node_modules/bunyan/lib/bunyan.js
            options['serializers']['req'] = function(req) {
                if (!req) {
                    return req;
                } else {
                    // let conn = req.connection != null ? req.connection : {};
                    let lcls = req.locals  != null ? req.locals  : {};
                    let hdrs = req.headers != null ? req.headers : {};
                    return {
                        method: req.method,
                        site: lcls.subdomain,
                        // Accept `req.originalUrl` for expressjs usage.
                        // https://expressjs.com/en/api.html#req.originalUrl
                        url: req.originalUrl || req.url,
                        userAgent: hdrs['user-agent'],
                        referer:hdrs.referer,
                        remoteAddress: req.ip,  // relies on trust-proxy
                        contentLen: hdrs['content-length'],
                        // remotePort: conn.remotePort,  //  not reliable thru proxy?
                        userId: req.user != null ? req.user.user_id : null,
                        userRole: req.userRole != null ? req.userRole : null
                    };
                }
            };
            options['serializers']['res'] = function(res) {
                if (!res) {
                    return res;
                } else {
                    return {
                        statusCode : res.statusCode
                    };
                }
            };
            
            // Create logger

            this.bunyanLog = bunyan.createLogger(options);
        }

        // Handle logging errors
        this.bunyanLog.on('error', this.handleStreamError.bind(this))
    }

    //
    // Creating a child logger
    //

    public childLogger(moduleName:string, options?:any) {
        if (options == null) {
            options = this.options;
        } else {
            let optProps = Object.keys(this.options);
            for (let i = 0; i < optProps.length; i++) {
                if (options[optProps[i]] == null) {
                    options[optProps[i]] = this.options[optProps[i]];
                }
            }            
        }

        let newBunyan = this.bunyanLog.child({mod :  moduleName});
        let newLogger = new Logger(this.name, this.filepath, this.basepath, options);

        newLogger.init(newBunyan)
        return newLogger;
    }

    //
    // core Bunyan logger, use this to pass into other libraries
    // that want a completely Bunyan-compatible logger
    //

    public coreLogger() {
        return this.bunyanLog;
    }

    //
    // Logger for Express requests
    // Use like:
    //
    //    app.use(logger.express());
    // or    
    //    app.use(logger.express(/node_modules/, 'skip'));
    //

    public express(regex?:string|RegExp|Array<string|RegExp>, mode?:string) {
        let reSkips:Array<string|RegExp> = null;
        
        if (regex) {
            if (Array.isArray(regex)) {
                reSkips = regex;
            } else {
                reSkips = [regex];
            }
        }
        let msg = "GVLogger logging HTTP requests";
        if (reSkips) {
            msg += " with RegExp qualification(s): " + reSkips.map(x => x.toString()).join(';');
            if (mode) {
                msg += ` => ${mode}`;
            }
        }
        this.info(msg);
 
        let _this = this;
        return function(req, res, next) {
            if (reSkips != null) {
                let matches = reSkips.some(re => req.url.match(re) !== null );
                
                if (mode == 'skip') {
                    if (matches)  { return next(); }
                } else {
                    if (!matches) { return next(); }
                }
            }

            let opts = {req : req, res : res};
            opts['time'] = (new Date()).toISOString();
            
            _this.bunyanLog.info(opts);
            next();
        }
    }

    //
    // Logging methods
    //

    public trace(opts:any, msg?:any, ...args:any[]) {
        this.handleLog(opts, msg, args, 'trace');
    }

    public debug(opts:any, msg?:any, ...args:any[]) {
        this.handleLog(opts, msg, args, 'debug');
    }

    public info(opts:any, msg?:any, ...args:any[]) {
        this.handleLog(opts, msg, args, 'info');
    }

    public warn(opts:any, msg?:any, ...args:any[]) {
        this.handleLog(opts, msg, args, 'warn');
    }

    // For a stack trace, issue error() and fatal() calls
    // (or other logger calls above)
    // with an Error object, either as the sole argument, or
    // as an 'err' property in the options.  I.e., either:
    //
    //   logger.error(new Error("bad stuff in processing"));
    //   logger.error({err : new Error("bad stuff")}, "bad instruction?");
    //

    public error(opts:any, msg?:any, ...args:any[]) {
        // hopefully opts.err is set to the error object!
        this.handleLog(opts, msg, args, 'error');
    }

    public fatal(opts:any, msg?:any, ...args:any[]) {
        // hopefully opts.err is set to the error object!
        this.handleLog(opts, msg, args, 'fatal');
    }

    //
    // private methods
    //

    private handleStreamError(err, stream) {
        console.error("Logger, got an error in logging to a stream!", err, stream);
    }

    private levelToStr(level:number) {
        switch(level) {
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
   }

    private handleLog(opts:any, msg:any, args:any[], logType:any) {
        let newOpts;

        revertConsoleRedirect();

        if (typeof opts === 'string') {
            if (msg) {
                args.unshift(msg);
            }
            msg     = opts;
            newOpts = {}
        } else {
            newOpts = opts;
        }

        for (let j = 0; j < args.length; j++) {
            newOpts['arg' + (j+1)] = args[j];
        }

        // If 'err' is one of the properties in opts, but is NOT an Error, 
        // then convert it to a string, and make it part of the message rather
        // than have it shown on a separate line as an 'arg'

        if ( opts.err && (!(opts.err instanceof Error)) ) {
            if ( typeof opts.err !== 'string' ) {
                try {
                    opts['err'] = JSON.stringify(opts.err);
                } catch (e) {
                    opts['err'] = opts.err + '';
                }
            }
        }

        if ( typeof opts.err === 'string' ) {
            if (!msg) { msg  = '';  }
            else      { msg += ': ';}
            msg += opts.err;
            delete opts.err;
        }


        var func = this.bunyanLog[logType].bind(this.bunyanLog);

        // Use ISO UTC timestamp
        newOpts['time'] = (new Date()).toISOString();

        let res;
        if (msg !== undefined) {
            res = func(newOpts, msg);
        }
        else {
            res = func(newOpts);
        }

        restoreConsoleRedirect();

        return res;
    }
}
