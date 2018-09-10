// inspired by http://cferdinandi.github.io/smooth-scroll/
function smoothScrollTo(element, container, duration, easing) {
  console.log("TO", element);
  container = container || window;
  console.log("IN", container);
  duration = duration || 500;
  // Set the animation variables to 0/undefined.
  var timeLapsed = 0;
  var percentage, position;

  var startLocation = container.pageYOffset;

  // Calculate the easing pattern
  var easingPattern = function (type, time) {
    if ( type == 'easeInQuad' ) return time * time; // accelerating from zero velocity
    if ( type == 'easeOutQuad' ) return time * (2 - time); // decelerating to zero velocity
    if ( type == 'easeInOutQuad' ) return time < 0.5 ? 2 * time * time : -1 + (4 - 2 * time) * time; // acceleration until halfway, then deceleration
    if ( type == 'easeInCubic' ) return time * time * time; // accelerating from zero velocity
    if ( type == 'easeOutCubic' ) return (--time) * time * time + 1; // decelerating to zero velocity
    if ( type == 'easeInOutCubic' ) return time < 0.5 ? 4 * time * time * time : (time - 1) * (2 * time - 2) * (2 * time - 2) + 1; // acceleration until halfway, then deceleration
    if ( type == 'easeInQuart' ) return time * time * time * time; // accelerating from zero velocity
    if ( type == 'easeOutQuart' ) return 1 - (--time) * time * time * time; // decelerating to zero velocity
    if ( type == 'easeInOutQuart' ) return time < 0.5 ? 8 * time * time * time * time : 1 - 8 * (--time) * time * time * time; // acceleration until halfway, then deceleration
    if ( type == 'easeInQuint' ) return time * time * time * time * time; // accelerating from zero velocity
    if ( type == 'easeOutQuint' ) return 1 + (--time) * time * time * time * time; // decelerating to zero velocity
    if ( type == 'easeInOutQuint' ) return time < 0.5 ? 16 * time * time * time * time * time : 1 + 16 * (--time) * time * time * time * time; // acceleration until halfway, then deceleration
    return time; // no easing, no acceleration
  };

  // Calculate how far to scroll
  var getEndLocation = function (element) {
    var location = 0;
    if (element.offsetParent) {
      do {
        location += element.offsetTop;
        element = element.offsetParent;
      } while (element);
    }
    //location = location// - headerHeight;
    if ( location >= 0 ) {
      return location;
    } else {
      return 0;
    }
  };
  var endLocation = getEndLocation(element);
  var distance = endLocation - startLocation;
  var up = endLocation < startLocation;
  //console.log('startLocation', startLocation, 'endLocation', endLocation, 'distance', distance, 'up?', up);

  // Stop the scrolling animation when the element is reached (or at the top/bottom of the page)
  var stopAnimation = function () {
    var currentLocation = container.pageYOffset;
    if (up) {
     if ( currentLocation == endLocation ) {
       //console.log('stop animation');
       clearInterval(runAnimation);
     }
    } else {
      if ( currentLocation == endLocation || ( (container.innerHeight + currentLocation) >= document.body.scrollHeight ) ) {
       //console.log('stop animation');
       clearInterval(runAnimation);
     }
    }
  };

  // Scroll the page by an increment, and check if it's time to stop
  var animateScroll = function () {
    timeLapsed += 16;
    percentage = ( timeLapsed / duration );
    percentage = ( percentage > 1 ) ? 1 : percentage;
    position = startLocation + ( distance * easingPattern(easing, percentage) );
    window.scrollTo( 0, position );
    stopAnimation();
  };

  var runAnimation = setInterval(animateScroll, 16);
}
