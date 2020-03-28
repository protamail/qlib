"use strict";
import * as rootActions from './actions.js';
import * as os from 'os';

class HttpError {
    constructor(status, text, noEscape) {
        this.status = status;
        this.text = text ?? "";
        this.noEscape = noEscape ?? false;
    }
}

globalThis.handleRequest = function(...kv) {
    let r = guardUndefRead(pair(kv));
    r.param = pair(r.param);
    r.actionScopeStack = [];
    r.templateParam = {};
    r.actionArray = r.originalActionPath.split(/\//);
    r.actionArray.shift();
    r.status = 200;
    r.dispatchOn = function (actionObj) {
        return _dispatch(this, actionObj, this.templateParam, this.actionScopeStack);
    }
    try {
        var result = r.dispatchOn(rootActions);
        if (result == null) {
            r.actionScopeStack.unshift(rootActions); // provide action scope for the JS error_handler
            _r.throwNotFound();
        }

        if (result == null)
            result = java.evalFilterChain()[0]; // defer to other filters

        if (result)
            java.sendTextResponse(0, result);
//        java.sendTextResponse(200, (new Date()).getTime() - r.startMillis);
        java.flushResponseBuffer();
    } catch(e) {
        let err = `${e}\n${e.stack}`;
        if (e instanceof HttpError) {
            r.status = e.status;
            err = `${e.text}`;
        }
        else
            console.log(err.replace(/^|\n/g, `\n${r.contextPath}: `));
        err = error_handler(r, e) ?? err;
        java.sendTextResponse(r.status != 200? r.status : 500, err);
    }
    return 1; // we finalized the request, don't try other filters
}

globalThis._r = {
    throwNotFound: () => { throw new HttpError(404, "NOT FOUND") },
    throwRedirect: (url) => { throw new HttpError(304, url) },
    throwUserError: (msg, noEscape) => { throw new HttpError(510, msg, noEscape) },
    throwSee: (val) => { throw new HttpError(201, see(val)) },
}

globalThis.java = new Proxy({}, {
    get: function(target, prop) {
        return function(...argv) {
            return callJava(prop, ...argv);
        }
    }
});

function pair(kv) {
    let r = {}, i = 0, l = kv.length;
    while (i < l)
        r[kv[i++]] = kv[i++];
    return r;
}

function guardUndefRead(obj) {
    return new Proxy(obj, {
        get: function(obj, prop) {
            let ret = obj[prop];
            if (ret === undefined)
                throw new Error(`No such property '${prop}' in ${see(obj)}`);
            return ret;
        }
    });
}

function error_handler(r, e) {
    for (var i = 0, ass = r.actionScopeStack, l = ass.length; i < l; i++) {
        var actionScope = ass[i];

        if ("__error__" in actionScope) {
            var error = actionScope["__error__"](r, r.param, r.templateParam, e);

            if (error != null)
                return error;
        }
    }
}

/*
 * Dispatch the current action
 * A handler must return null or undefined value to indicate no result
 * @param actionScope an object or array of objects to dispatch on
 * @return result of the handler if found, empty string otherwise
 */
function _dispatch(r, actionScope, templateParam, actionScopeStack) {

    if (actionScope == null)
        throw Error("_dispatch: actionScope can not be null");
    if (actionScopeStack.length > 100)
        throw Error("_dispatch: recursion too deep");

    var result, before, after;
    var actions = r.actionArray;
    var action = actions[0];
    var p = r.param;
    var d = actionScope.default;

    actionScopeStack.unshift(actionScope);

    // These will be processed right after request returns to the client
    if ("__postprocess__" in actionScope)
        r.afterRequestQueue.push(actionScope["__postprocess__"], r, p, templateParam);

    // NOTE: __before__ handler can skip normal processing by returning a value
    if (actionScopeStack[1] !== actionScope) { // skip __before__ if recursive
        if ("__before__" in actionScope)
            before = actionScope.__before__(r, p, templateParam);
    }

    if (before == null) { // skip normal processing if __before__ returned value

        // try exact match first (actionScope isn't regular Object, i.e. no prototype, no builtin props)
        if (action in actionScope && action !== "default") {
            actions.shift(); // remove top action for exact match processing
            result = actionScope[action](r, p, templateParam);
            actions.unshift(action); // restore current action for the rest of the processing
        }
        else if (d && action in d) {
            actions.shift();
            result = d[action](r, p, templateParam);
            actions.unshift(action);
        }

        // if no result from exact match, try  __default__ handler
        if (result == null) {
            if ("__default__" in actionScope) {
                result = actionScope.__default__(r, p, templateParam);
            }
        }
    }

    // NOTE: __after__ handler can override normal result by returning a value
    if (actionScopeStack[1] !== actionScope) { // skip __after__ if recursive
        if ("__after__" in actionScope)
            after = actionScope.__after__(r, p, templateParam, before != null? before : result);
    }

    actionScopeStack.shift();

    return result = before != null? before : after != null? after : result;
}

function see(a) {
    var stack = [];
    var ret = [];

    function print_rec(a) {
        var n, i, keys, key, type, s;

        type = typeof(a);
        if (type === "object") {
            if (a === null) {
                ret.push(a);
            } else if (stack.indexOf(a) >= 0) {
                ret.push("[circular]");
            } else {
                stack.push(a);
                let tab = [...Array(stack.length).keys()].map(() => "    ").join("");
                if (Array.isArray(a)) {
                    n = a.length;
                    ret.push("[");
                    for(i = 0; i < n; i++) {
                        if (i !== 0)
                            ret.push(",");
                        ret.push("\n", tab);
                        if (i in a) {
                            print_rec(a[i]);
                        } else {
                            ret.push("<empty>");
                        }
                        if (i > 20) {
                            ret.push("...");
                            break;
                        }
                    }
                    ret.push(" ]");
                } else if (Object.__getClass(a) === "RegExp") {
                    ret.push(a.toString());
                } else {
                    keys = Object.keys(a);
                    n = keys.length;
                    ret.push("{");
                    for(i = 0; i < n; i++) {
                        if (i !== 0)
                            ret.push(",");
                        ret.push("\n", tab);
                        key = keys[i];
                        ret.push(key, ": ");
                        print_rec(a[key]);
                    }
                    ret.push(" }");
                }
                stack.pop(a);
            }
       } else if (type === "string") {
            s = a.__quote();
            if (s.length > 79)
                s = s.substring(0, 75) + "...\"";
            ret.push(s);
        } else if (type === "symbol") {
            ret.push(String(a));
        } else if (type === "function") {
            ret.push("function " + a.name + "()");
        } else {
            ret.push(a);
        }
    }
    print_rec(a)
    return ret.join("");
}


