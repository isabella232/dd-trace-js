"use strict";

global.tracer = require("../../").init({
	service: "moleculer", // shows up as Service in Datadog UI
	//hostname: "agent", // references the `agent` service in docker-compose.yml
	debug: true,
	url: "http://192.168.0.181:8126",
	samplingPriority: "USER_KEEP",
});

global.tracer.use("http");
global.tracer.use("moleculer");
global.tracer.use("mongodb");
global.tracer.use("redis");

const { ServiceBroker }   = require("moleculer");
const { MoleculerError } 	= require("moleculer").Errors;

const _ 					    = require("lodash");
const { inspect }			= require("util");

const THROW_ERR = false;

// Create broker
const broker = new ServiceBroker({
	logger: console,
	logLevel: "info",
  cacher: "redis://localhost:6379",
	logObjectPrinter: o => inspect(o, { showHidden: false, depth: 4, colors: true, breakLength: 50 }),
	tracing: {
		events: true,
		stackTrace: true,
		exporter: [
			{
				type: "Console",
				options: {
					logger: console
				}
			},
			/*{
				type: "Datadog2",
				options: {
					agentUrl: "http://192.168.0.181:8126",
					samplingPriority: "USER_KEEP",
					tracerOptions: {
						debug: true,
					}
				}
      }*/
		]
	}
});

const POSTS = [
	{ id: 1, title: "First post", content: "Content of first post", author: 2 },
	{ id: 2, title: "Second post", content: "Content of second post", author: 1 },
	{ id: 3, title: "3rd post", content: "Content of 3rd post", author: 2 },
];

let mongoose = require("mongoose");
let Post;

broker.createService({
	name: "posts",
	actions: {
		find: {
			handler(ctx) {
				const posts = _.cloneDeep(POSTS);
        return Post.find({}).then(allDocs => {
          return this.Promise.all(posts.map(post => {
            return this.Promise.all([
              ctx.call("users.get", { id: post.author }).then(author => post.author = author),
              ctx.call("votes.count", { postID: post.id }).then(votes => post.votes = votes),
            ]);
          })).then(() => posts);
        });
				//return posts;
			}
		}
	},

  created() {
    // Connect to Mongoose and set connection variable
    mongoose.connect("mongodb://localhost:27017/trace-test", { useNewUrlParser: true }, function(err, db) {
      if(err) {
        console.log("database is not connected");
      }
      else {
        console.log("connected!!");
      }
    });
    let db = mongoose.connection;

    let PostSchema = mongoose.Schema({
      title: String
    });
    // Export Contact model
    Post = module.exports = mongoose.model("post", PostSchema);
  }
});

const USERS = [
	{ id: 1, name: "John Doe" },
	{ id: 2, name: "Jane Doe" },
];

broker.createService({
	name: "users",
	actions: {
		get: {
      cache: true,
			tracing: {
				tags: ["id", "#loggedIn.username"],
			},
			handler(ctx) {
				return this.Promise.resolve()
					.then(() => {
						const user = USERS.find(user => user.id == ctx.params.id);
						if (user) {
							const res = _.cloneDeep(user);
							return ctx.call("friends.count", { userID: user.id })
								.then(friends => res.friends = friends)
								.then(() => res);
						}
					});
			}
		}
	}
});

broker.createService({
	name: "votes",
	actions: {
		count: {
			tracing: {
				tags: ctx => {
					return {
						params: ctx.params,
						meta: ctx.meta,
						custom: {
							a: 5
						}
					};
				}
			},
			handler(ctx) {
				return this.Promise.resolve().delay(10 + _.random(30)).then(() => ctx.params.postID * 3);
			}
		}
	}
});

broker.createService({
	name: "friends",
	actions: {
		count: {
			tracing: true,
			handler(ctx) {
				if (THROW_ERR && ctx.params.userID == 1)
					throw new MoleculerError("Friends is not found!", 404, "FRIENDS_NOT_FOUND", { userID: ctx.params.userID });

				return this.Promise.resolve().delay(10 + _.random(60)).then(() => ctx.params.userID * 3);
			}
		}
	}
});

broker.createService({
	name: "api",
	actions: {
		rest: {
			handler(ctx) {
				return ctx.call(ctx.params.action, ctx.params.params);
			}
		}
	},
	created() {
		const http = require("http");
		this.server = http.createServer();
		this.server.on("request", async (req, res) => {
			try {
				const data = await this.broker.call("api.rest", {
					action: "posts.find"
				});
				res.setHeader("Content-Type", "application/json; charset=utf-8");
				res.end(JSON.stringify(data));
			} catch(err) {
				res.statusCode = 500;
				res.end(err.message);
			}
		});
	},

	started() {
		this.server.listen(3000, () => {
      this.logger.info("API gateway started on port 3000. Open http://localhost:3000/");
    });
	},

	stopped() {
		this.server.close();
	}
});

// Start server
broker.start().then(() => {
	broker.repl();

	// Call action
	//setInterval(() => {
	/*broker
		.call("posts.find", { limit: 5 }, { meta: { loggedIn: { username: "Adam" } } })
		.then(console.log)
		.catch(console.error);
*/
	//}, 5000);
});
