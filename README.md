# gv-logger
GroupVine Logger Utility

Supports both console- and log-file-friendly outputs, with the log
file in JSON format.

## Example Usage (in Typescript)

Initialize:

```
import {Logger, 
       LogLevel}   from 'gv-logger';

var logger = new Logger("server-name", myLogFile, serverBaseDir, {
    consoleLevel : LogLevel.Debug,
    fileLevel    : LogLevel.Info
});
logger.init();
```

To use:

```
logger.debug(`Module name: Some message ${some_variable}`);

logger.info(`Module name: Some message ${some_variable}`);
```

```
// If error is a javascript Error(), this will dump a stacktrace
logger.error({err: error}, "My module: error message");
```


