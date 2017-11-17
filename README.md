# QCon Demo 

This is a short demo I ran at QConSF 17. The talk regards making session stores more intelligent with analytical data.

The code included is a small Express.js app that uses Pug (formerly Jade) as a template engine and the Jade-Bootstrap for minimal styling and UI widgets.


## Setup

This app requires some sort of Redis instance with [ReBloom](https://github.com/RedisLabsModules/rebloom) installed.

You'll need to add in a few keys to make the demo app function. From `redis-cli`:

```
> lpush group-notifications "notification 1" "notification 2"
> sadd featured-pages "/pages/kyle" "/pages/redis" "/pages/labs"
```


To launch the app, run `npm install` as normal.

Then run the script with the `--connection` object.

```
$ node index.js --connection ./path/to/your/connection/object.json
```

The connection object is a (node_redis)[https://github.com/NodeRedis/node_redis] connection object stored as a JSON file.

After running `index.js` you should be able to connect by going to localhost:3000

