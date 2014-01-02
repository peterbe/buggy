/*global: get_gravatar, serializeObject */

'use strict';

var BUGZILLA_URL = 'https://api-dev.bugzilla.mozilla.org/1.3/';


var SAMPLE_BUGS = [

                 {component: "General",
                   product: "Socorro",
                   id: "953132",
                   unread: true,
                   summary: 'Create new group with "long queries" permission',
                   email: "mail@peterbe.com",
                   extract: "Bla bla bla bla bla bla",
                   status: "NEW",
                   resolution: ""
                 },

                 {component: "Middleware",
                   product: "Socorro",
                   id: "762114",
                   unread: true,
                   summary: "Add a new service to get release channels by product",
                   email: "mail@peterbe.com",
                   extract: "Bla bla bla bla bla bla",
                   status: "NEW",
                   resolution: ""
                 },
                 {component: "Middleware",
                   product: "Socorro",
                   id: "772230",
                   unread: true,
                   summary: "products/builds service should not use releases_raw directly",
                   email: "mail@peterbe.com",
                   extract: "Bla bla bla bla bla bla",
                   status: "NEW",
                   resolution: ""
                 },
                 {component: "Infra",
                   product: "Socorro",
                   id: "772659",
                   unread: true,
                   summary: "totalPages and totalCount doesn't add up in middleware",
                   email: "peterbe@mozilla.com",
                   extract: "Bla bla bla bla bla bla",
                   status: "RESOLVED",
                   resolution: "FIXED"
                 }
                 ];

// utils stuff
function makeCommentExtract(comment, max_length) {
  max_length = max_length || 75;
  if (comment.text.length > max_length) {
    return comment.text.substring(0, max_length - 1) + '\u2026';
  }
  return comment.text;
}

var module = angular.module('buggyApp', ['ngSanitize']);

BugsController.$inject = ['$scope', '$http'];

function BugsController($scope, $http) {

  $scope.bugs = [];
  $scope.in_config = false;

  $scope.toggleConfig = function() {
    $scope.in_config = ! $scope.in_config;
  };

  function fetchBugs(params) {
    var url = BUGZILLA_URL + 'bug';
    url += '?' + serializeObject(params);
    console.log("BUGZILLA URL", url);
    return $http.get(url);
  }

  function lastChangeTimeSorter(bug) {
    return bug.last_change_time;
  }

  function fetchAndUpdateBugs(callback) {
    fetchBugs({
      //product: 'Socorro',
      product: 'Webtools',
      //component: 'Middleware',
      component: 'Air Mozilla',
      include_fields: 'assigned_to,product,component,creator,status,id,resolution,last_change_time,creation_time,summary'
    }).success(function(data, status, headers, config) {
      console.log('Success');
      //console.dir(data);
      $scope.bugs = [];
      var bug_ids = [];
      //_.each(_.sortBy(data.bugs, lastChangeTimeSorter), function(bug, index) {
      _.each(data.bugs, function(bug, index) {
        //console.log(bug.last_change_time);
        // update the local storage
        asyncStorage.setItem(bug.id, bug);
        // keep a list of all IDs we use
        bug_ids.push(bug.id);
        // update the scope immediately
        //$scope.bugs.unshift(bug);
        $scope.bugs.push(bug);
      });
      asyncStorage.setItem('bugs', bug_ids);
      if (callback) callback();
    }).error(function(data, status, headers, config) {
      console.log('Failure');
      console.dir(data);
    });
  }

  function fetchComments(id, params) {
    params = params || {};
    var url = BUGZILLA_URL + 'bug/' + id + '/comment';
    url += '?' + serializeObject(params);
    console.log("BUGZILLA URL", url);
    return $http.get(url);
  }

  function fetchAndUpdateComments(bug, callback) {
    fetchComments(bug.id)
      .success(function(data, status, headers, config) {
        console.log('Comments Success');
        //console.dir(data);
        bug.comments = data.comments;
        if (bug.comments.length) {
          bug.extract = makeCommentExtract(_.last(bug.comments));
        }
        asyncStorage.setItem(bug.id, bug);
        if (callback) callback();
      }).error(function(data, status, headers, config) {
        console.log('Failure');
        console.dir(data);
      });
  }

  /* Pulls bugs from local storage and if nothing's there,
   * fetch it remotely */
  function loadBugs() {
    asyncStorage.getItem('bugs', function(value) {
      //console.log('VALUE');
      //console.dir(value);
      if (value != null) {
        var _count_to_pull = value.length;
        _.each(value, function(id, index) {
          asyncStorage.getItem(id, function(bug) {
            // count down
            _count_to_pull--;
            if (bug != null) {
              $scope.bugs.push(bug);
            } else {
              console.warn('No bug data on', id);
            }
            if (!_count_to_pull) {
              // all getItem calls have called back
              $scope.$apply();
              // start pulling down comments pre-emptively
              downloadSomeComments();
            }
          });
        });
      } else {
        // need to fetch remotely
        fetchAndUpdateBugs(function() {
          // start pulling down comments pre-emptively
          downloadSomeComments();
        });
      }
    });
  }
  // the very first thing to do
  loadBugs();


  /* Pulls down the comments for some bugs we haven't already
   * done so for.
   * This basically makes it more prepared so that clicking on
   * a bug you haven't already clicked on already has some of the content.
   * */
  var _downloaded_comments = 0;
  function downloadSomeComments() {
    console.log('Hmm... what to download?', _downloaded_comments);
    if (_downloaded_comments > 15) return;  // we've pre-emptively downloaded too much
    var _downloading = false;
    // we want to do this to the most recent bugs first
    _.each(_.sortBy($scope.bugs, lastChangeTimeSorter).reverse(), function(bug, index) {
      //console.log(index, bug.id, bug.summary, bug.last_change_time, bug.comments == null);
      if (!_downloading && bug.comments == null) {
        _downloading = true;
        _downloaded_comments++;
        console.log("FETCH", bug.id);
        fetchAndUpdateComments(bug, downloadSomeComments);
      }
    });
      //console.log(bug.last_change_time, bug.id, bug.comments == null);
  }

  $scope.bug = {
     empty: true
  };


  $scope.selectBug = function(bug) {
    $scope.in_config = false; // in case
    //console.log('selected');
    //console.dir(bug);
    bug.empty = false;
    bug.unread = false;
    fetchAndUpdateComments(bug);
    $scope.bug = bug;
  };

  $scope.avatarURL = function(email, size) {
    size = size || 64;
    var secure = document.location.protocol === 'https:';
    // commented out for offline dev return get_gravatar(email, size, secure);
    return 'static/images/avatar.png';
  };

  $scope.isEmail = function(text) {
    return text.match(/@/) && !text.match(/\s/);
  };

  $scope.displayTimeAgo = function(ts) {
    return moment(ts).fromNow();
  };

  $scope.clearLocalStorage = function() {
    asyncStorage.clear(function() {
      loadBugs();
    });
  };

  $scope.hasAdditionalComments = function(bug) {
    return bug.comments != null && bug.comments.length > 1;
  };

  $scope.countAdditionalComments = function(bug) {
    return bug.comments.length - 1;
  };

}
