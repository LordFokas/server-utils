import path from 'node:path';
import fs from 'node:fs';
import express from 'express';


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
export function serveModules(modules: string[], node_modules: string, base_url: string){
    const router = express.Router();
    for(const module of modules){
        router.use('/'+module, serveModule(module, node_modules, path.join(base_url, module)));
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
export function serveModule(module: string, node_modules: string, base_url: string){
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