/* this is just intended to mock-up a non-specific database, but we use Redis just because */

const
  redis = require('redis');
let client;

//lpush group-notifications "Sale on sweaters!" "QCon attendees get 20 percent off" "Act fast  [insert ecommerce jargon]" "Look, something about a sale..." "Oh gosh, I am running out of ideas for notifications"

function getGroupNotifications(req,res,next) {
  client.lrange('group-notifications',0,9, function(err,notifications) {
    if (err) { next(err); } else {
      req.groupNotifications = notifications;
      next();
    }
  });
}

function getFeaturedPages(req,res,next) {
  client.smembers('featured-pages',function(err,featuredPages) {
    if (err) { next(err); } else {
      req.featuredPages = featuredPages;
      next();
    }
  });
}

function connect(config) {
  client = redis.createClient(config);
} 

module.exports = {
  connect,
  getGroupNotifications,
  getFeaturedPages
}