var view = arguments[1]; // second argument to the wrapper function

/**
 * Custom error handler
 * @param e: java.lang.Throwable object, associated with the error
 */
export function __error__(r, p, t, e) {
    t.rootClass = "error-bg";

    if (r.ajaxRequest && e instanceof ValidationError) {
        r.skipErrorLogging = true;
        r.status = 510; // indicate JSON error response
        return r.toJSON({ code: "validation_error", hint: e.getMessage() });
    }
    else if (r.ajaxRequest)
        return;
    else if (!r.developmentMode && r.status == r.INITIAL_STATUS) {
        if (!("homeUrl" in t))
            t.homeUrl = "/";
        r.contentType = "text/html";
        t.title = "Server error";
        t.content = view.status500(t);
        return view.html(t);
    }
    else if (r.status == 404) {
        if (!("homeUrl" in t))
            t.homeUrl = "/";
        r.contentType = "text/html";
        t.title = "Not found";
        t.content = view.status404(t);
        return view.html(t);
    }
}

