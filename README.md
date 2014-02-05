# buggy

A client-side wrapper on the bugzilla.mozilla.org REST API.


### Distribution

To run this you can simply open `./client/index.html`. But for
production, you can run `python ./make.py` and it will generate all
the files optimized inside a directory called `./dist`.

See `python make.py --help` for more options.


### Hacking on buggy

It's just a plain HTML page with some css and javascript. No server
needed. Just check out the git repo:

    git clone https://github.com/peterbe/buggy.git
    cd buggy
    open client/index.html

And then edit `client/index.html` and `client/static/js/buggy.js`.

Tip: It's a good idea to tie running this to a domain. If you want to
run it on localhost do this:

    cd buggy/client
    python -m SimpleHTTPServer
    open http://localhost:8000/index.html
