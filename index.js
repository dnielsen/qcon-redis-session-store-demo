var
  argv        = require('yargs')                                // bring in the command line arguments
                .demand('connection')                           // require a node_redis connection object path
                .argv,                                          // return it back as a plain object
  connection  = require(argv.connection),                       // bring in the conection JSON object
  redis       = require('redis'),                               // node_redis module
  express     = require('express'),                             // http server module
  parseurl    = require('parseurl'),                            // parse URLs into plain objects
  session     = require('express-session'),                     // session management
  rebloom     = require('redis-rebloom'),                       // bindings for the redis bloom filter
  db          = require('./db.module.node.js'),                 // "Dummy" database (actually Redis :) )
  rk          = require('rk'),                                  // easily create redis keys
  app         = express(),                                      // instantiate the HTTP server
  RedisStore  = require('connect-redis')(session),              // pass the session module into it, giving it superpowers
  sessionRedisClient,                                           // our Redis client instance
  rs,                                                           // we'll place our redis session store module here
  client,                                                       // this is the client for the dummy database
  baseTimeStamp 
              = new Date(2017, 10, 1).getTime();                // epoch - for demo purposes, not floating.

db.connect(connection);                                         // connect the dummy database, just for illustration     
rebloom(redis);                                                 // give Redis bloom filter powers
sessionRedisClient = redis.createClient(connection);            // create the connection to redis
rs = new RedisStore({                                           // instantiate the RedisStore object
  client  : sessionRedisClient                                  // give it the specified connection
});


function minutesSinceBase() {                                   // helper function to get the number of minutes since the epoch
  return Math.floor((Date.now() - baseTimeStamp)/60000);
}
function sumArray(arr) {                                        // helper function to sum an array of intergers
  return arr.reduce((a, b) => a + b, 0);
}


app.set('view engine', 'pug');                                  // we're using the jade/pug rendering engine
app.use(                                                        // app use to set a middleware
  session({                                                     // inject the session management middlewear
    saveUninitialized   : true,                                 // our options
    resave              : true,
    secret              : 'hello qcon',
    store               : rs
  })
);
app.use('/static',express.static('static'));                    // static file server for CSS, etc

app.use(function(req,res,next) {                                // another middleware - this time to record basic anayltics
  var 
    pathname = parseurl(req).pathname,                          // strip off query sting
    minuteOffset = minutesSinceBase(),                          // calcuate for bitcounting
    sessionAnalyticsMulti;                                      // we'll hold our transaction here

  req.sessionKeys = {                                           // injecting into `req` makes this object available to each subsquent route or middleware
    pageBloom   : rk('sess-page-bloom',req.sessionID),          // our page view bloom filter key
    pageHLL     : rk('sess-page-hll',req.sessionID),            // our hyperloglog key
    totalPages  : rk('sess-page-visist',req.sessionID),         // our counter key
    groupNotifications
                : rk('sess-notifications',req.sessionID),       // our notification bloom filter key
    activity    : rk('sess-activity',req.sessionID)             // our activity bit counting key 
  };

  sessionAnalyticsMulti = sessionRedisClient.multi();           // start the multi

  sessionAnalyticsMulti                                         // each item in the chain will add to the multi
    .pfadd(                                                     // hyperloglog add - for unique page views
      req.sessionKeys.pageHLL,                                  // predefined key
      pathname                                                  // the path name only
    )
    .bf_exists(                                                 // Check for existence in the bloom filter
      req.sessionKeys.pageBloom,                                // predefined key
      pathname                                                  // the path name only
    )
    .bf_add(                                                    // add it to the bloom filter - we call the check first to see a pre/post view of the bloom filter
      req.sessionKeys.pageBloom,                                // predefined key
      pathname                                                  // the path name only
    )
    .incr(req.sessionKeys.totalPages)                           // increment the page counter
    .pfcount(                                                   // counter the number of pages in the hyperloglog
      req.sessionKeys.pageHLL
    )
    .bitfield(req.sessionKeys.activity,                         // use the activity bitcount field
      'GET', 'u1',minuteOffset,                                 // first get the u1 (binary) value at the minute offset
      'SET','u1',minuteOffset,'1')                              // then set the u1 (binary) value at the minute offset
    .bitfield(req.sessionKeys.activity,                         // use the activity bitcount field
      'GET', 'u1',minuteOffset-5,                               // T-5 minutes activity
      'GET', 'u1',minuteOffset-4,                               // T-4 minutes activity
      'GET', 'u1',minuteOffset-3,                               // T-3 minutes activity
      'GET', 'u1',minuteOffset-2,                               // T-2 minutes activity
      'GET', 'u1',minuteOffset-1);                              // T-1 minutes activity (remember, 0 based)
    

    // this just shows how many bytes are being used by the analytics - not needed in a production system at all
    Object.keys(req.sessionKeys)                                // iterate through all the keys in the session analytics var
      .forEach(function(aKey) {                                 
        sessionAnalyticsMulti.memory(                           // check the usage of the memory for each item in the session analytics
          'usage',
          req.sessionKeys[aKey]
        );
      }
    );

    sessionAnalyticsMulti.exec(function(err,results) {          // execute the transaction
      if (err) { next(err); } else {                            // handle the error
        req.sessionInfo = {                                     // stow the results in the `req` object that persists on all the routes/middlewares
          uniquePageViews   : results[4],                       // the HLL count
          previouslyVisited : results[1] === 1 ? true : false,  // translate 0/1 for the page visit bloom filter to boolean
          totalSessionPages : results[3],                       // the value of the counter     
          activityThisMinute
                            : results[5][0] == 1 ? true : false,// get the bit out of the activity and translate it to true/false
          activityOverLast5 : results[6]                        // pull out the activity from the bit count
        };

        req.memoryMonitor = {};                                 // create the plain object ot hold the memory of the session analytics vars
        Object.keys(req.sessionKeys).forEach(
          function(aKey,index) {
            req.memoryMonitor[aKey] = results[index+7];         // pull them into the memory
          }
        );

        next(err);                                              // go to the next middleware in the chain
      }
    });
});

/* Special Combo pages */
const specialPages = [                                          // These are just few hard coded examples of pages that make up the "combo"
  '/pages/kyle',
  '/pages/redis',
  '/pages/labs'
];
function comboPages(req,specialPages,cb) {                      // abstract checking the bloom filter because we use it a couple of times            
  sessionRedisClient.bf_mexists(                                // BF.MEXISTS - varadic redis call to check one bloom filter for multiple items
    req.sessionKeys.pageBloom,                                  // the key for this sessions bloom filter
    specialPages,                                               // we can pass an array into the function and node_redis will resolve it into individual redis arguments
    function(err,results) {
      if (err) { cb(err); } else {                              // pass the error to the callback if it's truthy
        cb(err,results);                                        // err will be falsey so then we past the results to the callback
      }
    }
  );
}

app.get('/combo',function(req,res,next) {                       // for the combo route
  comboPages(req,specialPages,function(err,existResults) {      // we pass in the special pages here
    if (err) { next(err); } else {                              // handle the error
      if (sumArray(existResults) === 3) {                       // the result will look like this [0,0,0], so if they're all 1's the SUM will be 3
        req.template = 'anypage';                               // we use a generic page template
        req.pageData = {                                        // hand our data
          page : 'The Secret',
          note : 'You made the combo (probably)! This page is unlocked when '+specialPages.join(', ')+' have all been visited.'
        };
      } 
      next();                                                   // pass it on to the next item in the middleware (rendering!)
    }
  });
});
app.get(specialPages.join('|'),function(req,res,next) {         // the `join` here just matches any of the special pages (| represents OR in express path syntax)
  comboPages(req,specialPages,function(err,notVisitedResults){  // checking vs the bloom filter
    if (err) { next(err); } else {                              // handle the error
      req.links = [];                                           // instantiate the links array 
      specialPages.forEach(function(aSpecialPage,index) {       // compare the special pages vs the bloom filter results
        if (notVisitedResults[index] !== 1) {                   // the bloom filter will return as 0 (doesn't exists) / 1 (probably does exist)
          req.links.push(specialPages[index]);                  // push it in if it probably exists
        }
      });
      if (req.links.length === 0) {                             // if we eneded up with all the special pages in the bloom filter...
        req.links.push('/combo');                               // then push out our secret page           
      }
      next();                                                   // pass to the next middleware
    }      
  });
});


function markSeenFromQueryString(req,res,next) {                // middleware to mark a notification as seen 
  if (req.query.seen) {                                         // if we have `?seen` in the query string
    sessionRedisClient.bf_add(                                  // add an item to the bloom filter
      req.sessionKeys.groupNotifications,                       // the key to the group notification
      req.query.seen,                                           // value of the after the `=` 
      (err) => next(err)                                        // pass it to the next middleware
    );
  } else {                                                      // if we don't have a `?seen`
    next();                                                     // then we pass to the next item without doing anything
  }
}

function onlyNotFoundInBloomFilter(arr,filterKey,cb) {          // Get the items that are *not* found in the bloom filter (inversion)
  if (arr.length === 0) {                                       // if we have nothing in the notification array...
    cb(null,arr);                                               // then everything is unread :)
  } else {
    sessionRedisClient.bf_mexists(                              // check if multiple items exist
      filterKey,                                                // our bloom filter key
      arr,                                                      // and our item's were checking against
      function(err,existsArr) {                                 
        let emptyBloomFilter = 
          String(err).indexOf('not found') >= 0 ? true : false; // if the bloom filter doesn't exist, then we know it's not in it :)
        
        if (err && !emptyBloomFilter) { cb(err); } else {       // check to see if we have an error and that error is not that it doesn't exist
          err = null;
          existsArr = emptyBloomFilter ? [] : existsArr;        // Exists array is will be empty if the bloom filter is empty otherwise we'll use the exists array
          cb(
            err,                                                // this will be null/falsey
            arr.filter(function(el,index) {                     // filter out non existent items from the bloom fliter
              return (existsArr[index] === 0) || emptyBloomFilter;
            })
          );
        }
      }
    );
  }
}


app.get('/group-notifications',                                 // the group notifications page
  markSeenFromQueryString,                                      // check for any query strings that need to be handled
  db.getGroupNotifications,                                     // get the notifications
  function(req,res,next) {
    onlyNotFoundInBloomFilter(                                  // return back only the found items
      req.groupNotifications,
      req.sessionKeys.groupNotifications,
      function(err,filteredArr) {

        if (err) { next(err); } else {                          // handle the error
          req.template = 'notifications';                       // set the template
          req.pageData = {
            notifications : req.groupNotifications
              .map(function(aNotification) {                    // map over the notifications
                return  {                                       // returning an object for each array element
                  text    : aNotification,                      // always return the next of the notification                
                  seen    : filteredArr                         // seen is determined if it's in eliminated notification array
                    .indexOf(aNotification) >= 0 ? true : false,
                  link    : '?seen='+aNotification              // the link is just the same page with the query string
                };
              })
          };
          next();                                               // go on to the next middleware (rendering)
        }
      }
    );
  }
);

app.get('/',                                                    // the index page
  db.getFeaturedPages,                                          // grab the featured pages from the mock database
  function(req,res,next) {
    onlyNotFoundInBloomFilter(                                  // featured pages use the same logic as the notifications
      req.featuredPages,                                        // featured pages are passed in through our db middleware
      req.sessionKeys.pageBloom,                                // our bloom filter key
      function(err,filteredFeaturedPages) {
        if (err) { next(err); } else {                          // handle err
          req.template = 'index';                               // set the template
          req.pageData = {
            featuredPages  : filteredFeaturedPages.slice(0,2)   // just grab the first couple
          };
          next();                                               // pass to the next middleware (rendering)
        }
      }
    );
  }
);

app.get('/pages/:anypage', function (req, res, next) {          // this just a generic page view
  req.template = 'anypage';                                     // the generic page template
  req.pageData = {                                              // the the data that will be rendered by PUG/Jade
    page  : req.params.anypage,                                 // the page path itself
    links : req.links                                           // links, if they exist
  };
  next();
});

app.use(function(req,res,next) {                                // This is our rendering middleware/route
  if (req.template) {                                           // if we have a template passed in, then we render
    let pageData = req.pageData || {};                          // pageData, if it doesn't exist then it's an empty object
    pageData.sessionInfo = req.sessionInfo;                     // pass in the session info, which is mainly just the stats
    pageData.memoryMonitor = req.memoryMonitor;                 // oass in the memory usage         
    if (pageData.sessionInfo.totalSessionPages === 1) {         // is this the first time?
      pageData.notice = 
        'Hi, welcome on your first visit to this site!';
    }


    if ((pageData.sessionInfo.totalSessionPages > 1) &&         // let's determine if you're inactive - logically you have to have had more views than one!
        (pageData.sessionInfo.activityThisMinute === false) &&  // no activity this minute
        ( sumArray(
            pageData.sessionInfo.activityOverLast5
          ) === 0)) {                                           // nor the last 5 minutes
      pageData.notice = 'You haven\'t been active in the last 5 minutes :(';
    }
    res.render(                                                 // render the page to pug/jade
      req.template,
      pageData
    );
  } else {
    next();                                                     // otherwise we just skip rendering (and it's a 404)
  }
});

app.enable('view cache');                                       // so we don't have to constantly parse the template
app.listen(3000,function() {                                    // launch on port localhost/3000
  console.log('Server started!');
});