import path from 'node:path';
import fs from 'node:fs';

import { type Server as HTTPServer } from 'node:http';
import { type Server as HTTPSServer } from 'node:https';
import type express from 'express';
import { type Logger } from '@lordfokas/loggamus';


/**
 * Shortcut to serve multiple node modules via express.
 * 
 * See {@link serveModule} for more technical module-level documentation
 * 
 * @param modules whitelist of modules to serve
 * @param node_modules path to node_modules
 * @param base_url path from the root of the server to this module router
 * @returns express.Router() serving all given modules as if it were the `node_modules` dir
 */
export async function serveModules(modules: string[], node_modules: string, base_url: string){
    const express = await import('express');

    const router = express.Router();
    for(const module of modules){
        router.use('/'+module, await serveModule(module, node_modules, path.join(base_url, module)));
    }
    return router;
}


/**
 * Serve the contents of a node module via express.
 * 
 * See {@link serveModules} for a multi-module shortcut
 * 
 * Automatically resolves the following:
 * - Package entry point (main / module / browser keys)
 * - Package submodule exports (exports object)
 * - Resolution is performed via HTTP 3XX redirect to absolute path
 * so as to not break relative path module imports
 * 
 * The entry point priority from `package.json` is as follows:
 * `browser > module > main`
 * 
 * @param module module to serve
 * @param node_modules path to node_modules
 * @param base_url path from the root of the server to this module root
 * @returns express.Router() serving this one specific module
 */
export async function serveModule(module: string, node_modules: string, base_url: string){
    const express = await import('express');

    const router = express.Router();
    const dir = path.join(node_modules, module);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json")).toString());

    // Serve main lib file
    const main = path.join(base_url, pkg.browser ?? pkg.module ?? pkg.main);
    router.get('/', (_, res) => redirectModule(res, main));

    // Serve lib submodules
    const pkg_exports: Record<string, string> = pkg.exports ?? {};
    for(const [exp, file] of Object.entries(pkg_exports)){
        let submodule = exp.replace(/^\.\/?/, '');
        if(submodule.length == 0) continue; // main module, ignore, already served.
        if(submodule.endsWith('*')){ // glob submodules
            router.get("/"+submodule.replace(/\*$/, ':file'), (req, res) => {
                const reqfile = path.join(base_url, file.replace('*', req.params.file));
                redirectModule(res, reqfile);
            });
            continue;
        }
        
        if(file.endsWith(".js")){ // file submodule
            const target = path.join(base_url, file);
            router.get("/"+submodule, (_, res) => redirectModule(res, target));
        }else{ // dir submodule
            router.get("/"+submodule, (req, res) => redirectModule(res, path.join(base_url, submodule, req.url)));
        }
    }

    // Serve lib files directly (fallback)
    router.use("/", express.static(dir));

    return router;
}

function redirectModule(res: express.Response, location: string){
    res.header("location", location).sendStatus(302);
}


/**
 * Attaches shutdown logic to an HTTP(S) Server.
 * 
 * On SIGINT (Ctrl+C), attempts to gracefully shutdown the server.
 * Further SIGINT will be ignored until the timeout is reached.
 * At this point the shutdown mode switches from Graceful to Kill and
 * the next SIGINT will terminate the process with exit code -1.
 * 
 * @param server HTTP(S) server to attach a shutdown manager to
 * @param timeout How long a server has to shutdown gracefully before the shutdown manager turns aggressive.
 * @param logger Optional `@lordfokas/loggamus` Logger to display messages with.
 */
export async function managedShutdown(server: HTTPServer | HTTPSServer, timeout: number, logger?: Logger) {
    const GSM = await import("@moebius/http-graceful-shutdown");

    const gsm = new GSM.GracefulShutdownManager(server);
    let graceful = true; // Shutdown mode: Graceful | Kill
    let terminating = false; // Is already terminating?
    let timer: NodeJS.Timeout; // Graceful shutdown timeout

    process.on("SIGINT", () => {
        // Attempt to shut down gracefully
        if(graceful){
            if(terminating) return; // If already terminating, ignore further requests.
            terminating = true;

            logger?.warn("\nCaught SIGINT from user (Ctrl+C), shutting down");

            // Ask the HTTP server to stop accepting further connections and finish ongoing ones.
            gsm.terminate(() => { // Callback runs when the server fully shuts down.
                if(timer){
                    clearTimeout(timer); // Clear existing shutdown timeout so the process can terminate.
                }
                logger?.info("Server terminated gracefully");
            });

            // Set a timeout to switch the shutdown mode of next SIGINT to agressive (kill)
            // in case the server refuses to terminate (something hanged and the process is stuck)
            timer = setTimeout(() => {
                logger?.forceStackTrace(false).error(
                    "\nProcess still running after graceful shutdown timeout!\n"+
                    "/!\\ Switiching shutdown mode from Graceful to Kill /!\\"
                );
                graceful = false;
            }, timeout);
        }

        // Aggressively terminate the process
        else{
            logger?.forceStackTrace(false).fatal("\nKilled by user after unresponsive graceful shutdown");
            process.exit(-1);
        }
    });

    logger?.info("Set up HTTPD graceful shutdown");
}