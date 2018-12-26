import * as bunyan     from 'bunyan';
import * as bunyanDbg  from 'bunyan-debug-stream';

export enum LogLevel {
    // levels set same as bunyan levels
    Fatal   = 60,
    Error   = 50,
    Warn    = 40,
    Info    = 30,
    Debug   = 20,
    Trace   = 10
};

export function console2Logger(logger:any) {
    ["log", "warn", "error"].forEach(function(method) {
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
                    stream : bunyanDbg({
                        basepath   : this.basepath,  
                        forceColor : true,
                        prefixers: {
                            // Add (child) module to line, if present 
                            'mod': function(mod) {return mod ? mod : null;}
                        }
                        // out        : process.stdout ... stderr?
                    })
                });
            } else {
                delete options.consoleOff;
            }

            //
            // Set serializers (just the standard one for now, for errors)
            //

            options.serializers = bunyan.stdSerializers;

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
    //    app.use(/node_modules/, 'skip');
    //

    public express(regex?:string, mode?:string) {
        let msg = "Logging HTTP requests";
        if (regex) {
            msg += " with RegExp qualification: " + regex.toString();
            if (mode) {
                msg += ` => ${mode}`;
            }
        }
        this.info(msg);
 
        let _this = this;
        return function(req, res, next) {
            if (regex) {
                let matches = (req.url.match(regex) !== null);
                if (mode == 'skip') {
                    if (matches)  { return next(); }
                } else {
                    if (!matches) { return next(); }
                }
            }
            _this.bunyanLog.info({req : req, res : res});
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

        if (msg !== undefined) {
            return func(newOpts, msg);
        } else {
            return func(newOpts);
        }
    }
}
