import path from 'node:path';
import fs from 'node:fs';
import express from 'express';

/**
 * Serve the contents of a node module via express.
 * Requires express to be installed.
 * 
 * Automatically resolves the following:
 * - Package entry point (main / module / browser keys)
 * - Package submodule exports (exports object)
 * - Resolution is performed via HTTP 3XX redirect to absolute path
 * so as to not break relative path module imports (NOT IMPLEMENTED YET!)
 * 
 * The entry point priority from `package.json` is as follows:
 * - browser
 * - module
 * - main
 * 
 * @param module module to serve
 * @param node_modules path to node_modules
 * @returns express.Router() serving this one specific module
 */
export function serveModule(module: string, node_modules: string){
    const router = express.Router();
    const dir = path.join(node_modules, module);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json")).toString());

    // Serve main lib file
    const main = path.join(dir, pkg.browser ?? pkg.module ?? pkg.main);
    router.get('/', (_, res) => res.sendFile(main));

    // Serve lib submodules
    const pkg_exports: Record<string, string> = pkg.exports ?? {};
    for(const [exp, file] of Object.entries(pkg_exports)){
        let submodule = exp.replace(/^\./, '');
        if(submodule.length == 0) continue; // main module, ignore, already served.
        if(submodule.endsWith('*')){ // glob submodules
            router.get("/"+submodule.replace(/\*$/, ':file'), (req, res) => {
                const reqfile = path.join(dir, file.replace('*', req.params.file));
                const relative = path.relative(dir, reqfile);
                const isInModule = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
                if(isInModule){
                    res.sendFile(reqfile);
                }else{
                    res.sendStatus(403);
                }
            });
            console.log(submodule, '=>', path.join(dir, file));
            continue;
        }
        const target = path.join(dir, file);
        if(file.endsWith(".js")){ // file submodule
            router.get("/"+submodule, (_, res) => res.sendFile(target));
        }else{ // dir submodule
            router.use("/"+submodule, express.static(target));
        }
        console.log(submodule, '=>', target);
    }

    // Serve lib files directly (fallback)
    router.use("/"+module, express.static(dir));
    console.log('');

    return router;
}