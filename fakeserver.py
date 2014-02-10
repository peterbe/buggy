import datetime
from random import randint
from time import sleep
import tornado.httpserver
import tornado.ioloop
import tornado.web


class BaseHandler(tornado.web.RequestHandler):
    def options(self, *args, **kwargs):
        self.set_header("Access-Control-Allow-Origin", "*")
        self.set_header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS")
        self.set_header("Access-Control-Allow-Headers", "*")
        self.set_header("Access-Control-Allow-Headers",
        "Content-Type, Depth, User-Agent, X-File-Size, X-Requested-With, X-Requested-By, If-Modified-Since, X-File-Name, Cache-Control")
        self.write('')



class CommentHandler(BaseHandler):
    def post(self, bug_id):
        sleep(3)
        self.set_header("Access-Control-Allow-Origin", "*")
        self.set_header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS")
        self.set_header("Access-Control-Allow-Headers", "*")
        self.set_header("Access-Control-Allow-Headers",
        "Content-Type, Depth, User-Agent, X-File-Size, X-Requested-With, X-Requested-By, If-Modified-Since, X-File-Name, Cache-Control")
        print self.request.body
        if randint(1, 4) == 1:
            self.set_status(400)
            self.write({'error': "Something terrible happened %s" % datetime.datetime.utcnow()})
        else:
            self.write("Hello, POST %s" % bug_id)


class UpdateHandler(BaseHandler):
    def put(self, bug_id):
        sleep(3)
        self.set_header("Access-Control-Allow-Origin", "*")
        self.set_header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS")
        self.set_header("Access-Control-Allow-Headers", "*")
        self.set_header("Access-Control-Allow-Headers",
        "Content-Type, Depth, User-Agent, X-File-Size, X-Requested-With, X-Requested-By, If-Modified-Since, X-File-Name, Cache-Control")
        print self.request.body
        if randint(1, 3) == 1:
            self.set_status(400)
            self.write({'error': "Unable to make PUT"})
        else:
            self.write("Hello PUT %s" % bug_id)


from tornado.options import define, options
define("debug", default=False, help="run in debug mode", type=bool)
define("port", default=8888, help="run on the given port", type=int)

def main():
    tornado.options.parse_command_line()
    application = tornado.web.Application([
        (r"/bug/(?P<bug_id>\d+)/comment", CommentHandler),
        (r"/bug/(?P<bug_id>\d+)", UpdateHandler),
    ], debug=options.debug)
    http_server = tornado.httpserver.HTTPServer(application)
    print "Starting tornado on port", options.port
    http_server.listen(options.port)
    try:
        tornado.ioloop.IOLoop.instance().start()
    except KeyboardInterrupt:
        pass



if __name__ == "__main__":
    main()
