// from http://www.deluxeblogtips.com/2010/04/get-gravatar-using-only-javascript.html
// with some modifications
function get_gravatar(email, size, secure) {
  secure = secure || false;
  var size = size || 80;
  var base;
  if (secure) base = 'https://secure.gravatar.com/';
  else base = 'http://www.gravatar.com/';
  return base + 'avatar/' + MD5(email) + '.jpg?s=' + size;
}


// http://stackoverflow.com/a/1714899/205832
serializeObject = function(obj) {
  var str = [];
  for(var p in obj)
    if (obj.hasOwnProperty(p)) {
      str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
    }
  return str.join("&");
}


// so you can find out if something is a bug ID
function isAllDigits(x) {
  return !x.match(/[^\d]/);
}
