/*global: get_gravatar, serializeObject, filesize */

'use strict';

var BUGZILLA_URL = 'https://api-dev.bugzilla.mozilla.org/1.3/';
var MAX_BACKGROUND_DOWNLOADS = 20;

var _INCLUDE_FIELDS = 'assigned_to,product,component,creator,status,id,resolution,last_change_time,creation_time,summary';
var _ALL_POSSIBLE_STATUSES = 'UNCONFIRMED,NEW,ASSIGNED,REOPENED,RESOLVED,VERIFIED,CLOSED'.split(',');
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
  $scope.data_downloaded = 0;
  $scope.all_possible_statuses = _ALL_POSSIBLE_STATUSES;
  $scope.selected_statuses = [];
  localForage.getItem('selected_statuses', function(value) {
    if (value != null) {
      $scope.selected_statuses = value;
      $scope.$apply();
    }
  });

  $scope.loaders = {
     fetching_bugs: false,
     fetching_comments: false,
     refreshing_bug: false,
     refreshing_bugs: false
  };

  $scope.errors = {
     update_comments: false
  };

  $scope.config_stats = {
     data_downloaded_human: '',
     total_comments: 0

  };

  $scope.filterByStatus = function(status) {
    if (status === 'ALL') {
      $scope.selected_statuses = [];
    } else if (_.contains($scope.selected_statuses, status)) {
      $scope.selected_statuses = _.filter($scope.selected_statuses, function(s) {
        return s !== status;
      });
    } else {
      $scope.selected_statuses.push(status);  // TODO uniqueness test
    }
    localForage.setItem('selected_statuses', $scope.selected_statuses);
  };

  $scope.isSelectedStatus = function(status) {
    return _.contains($scope.selected_statuses, status);
  };

  $scope.isFilteredStatus = function(bug) {
    if (!$scope.selected_statuses.length) return true;
    return _.contains($scope.selected_statuses, bug.status);
  };

  $scope.countByStatus = function(status) {
    if (status === 'ALL') {
      return $scope.bugs.length;
    } else {
      var count = 0;
      _.each($scope.bugs, function(bug) {
        if (bug.status === status) count++;
      });
      return count;
    }
  };

  $scope.toggleConfig = function() {
    if (!$scope.in_config) {
      // before opening the config pane, preload some stats

      $scope.config_stats.total_bugs = $scope.bugs.length;
      $scope.config_stats.data_downloaded_human = filesize($scope.data_downloaded);
      var total_comments = 0;
      _.each($scope.bugs, function(bug) {
        if (bug.comments) {
          total_comments += bug.comments.length;
        }
      });
      $scope.config_stats.total_comments = total_comments;
    }
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
  //$scope.lastChangeTimeSorter = lastChangeTimeSorter;
  $scope.lastChangeTimeSorter = function(bug) {
    console.log(bug.id, bug.last_change_time);
    return bug.last_change_time;
  }

  function fetchAndUpdateBugs(callback) {
    fetchBugs({
      //product: 'Socorro',
      product: 'Webtools',
      //component: 'Middleware',
      //component: 'Air Mozilla',
      component: 'kanbanzilla',
      include_fields: _INCLUDE_FIELDS
    }).success(function(data, status, headers, config) {
      console.log('Success');
      //console.dir(data);
      $scope.data_downloaded += JSON.stringify(data).length;
      $scope.bugs = [];
      var bug_ids = [];
      //_.each(_.sortBy(data.bugs, lastChangeTimeSorter), function(bug, index) {
      var _count_to_pull = data.bugs.length;
      _.each(data.bugs, function(bug, index) {
        // update the local storage
        localForage.getItem(bug.id, function(existing_bug) {
          _count_to_pull--;
          if (existing_bug != null) {
            // we already have it, merge!
            bug.comments = existing_bug.comments;
            bug.extract = existing_bug.extract;
          }
          localForage.setItem(bug.id, bug);
          $scope.bugs.push(bug);
          if (!_count_to_pull) {
            $scope.$apply();
          }
        });
        // keep a list of all IDs we use
        bug_ids.push(bug.id);
        // update the scope immediately
        //$scope.bugs.unshift(bug);

      });
      localForage.setItem('bugs', bug_ids);
      if (callback) callback();
    }).error(function(data, status, headers, config) {
      console.log('Failure');
      console.dir(data);
    });
  }

  function fetchAndUpdateBug(bug, callback) {
    fetchBugs({
      id: bug.id,
      include_fields: _INCLUDE_FIELDS
    }).success(function(data, status, headers, config) {
      console.log('Success');
      $scope.data_downloaded += JSON.stringify(data).length;
      //console.dir(data);
      if (data.bugs.length) {
        var bug = data.bugs[0];
        _.each($scope.bugs, function(old_bug, index) {
          if (old_bug.id === bug.id) {
            $scope.bugs[index] = bug;
          }
        });
        // update the local storage too
        localForage.setItem(bug.id, bug);
      }
      if (callback) callback();
    }).error(function(data, status, headers, config) {
      console.log('Failure to update bug');
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
    console.log('About to update comments');
    fetchComments(bug.id)
      .success(function(data, status, headers, config) {
        console.log('Comments Success');
        $scope.data_downloaded += JSON.stringify(data).length;
        //console.dir(data);
        bug.comments = data.comments;
        if (bug.comments.length) {
          bug.extract = makeCommentExtract(_.last(bug.comments));
        }
        localForage.setItem(bug.id, bug);
        if (callback) callback();
      }).error(function(data, status, headers, config) {
        console.warn("Failure to update bugs' comments");
        if (status === 0) {
          // timed out, possibly no internet connection
        } else {
          $scope.errors.update_comments = true;
        }
        console.dir(data);
        console.log('STATUS', status);
        console.log('HEADERS');
        console.dir(headers);
        console.log('CONFIG');
        console.dir(config);
        if (callback) callback();
      });
  }

  /* Pulls bugs from local storage and if nothing's there,
   * fetch it remotely */
  function loadBugs(callback) {
    localForage.getItem('bugs', function(value) {
      //console.log('VALUE');
      //console.dir(value);
      if (value != null) {
        var _count_to_pull = value.length;
        _.each(value, function(id, index) {
          localForage.getItem(id, function(bug) {
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
              if (callback) callback();
            }
          });
        });
      } else {
        // need to fetch remotely
        $scope.loaders.fetching_bugs = true;
        fetchAndUpdateBugs(function() {
          $scope.loaders.fetching_bugs = false;
          // start pulling down comments pre-emptively
          downloadSomeComments();
          if (callback) callback();
        });
      }
    });
  };

  // the very first thing to do
  loadBugs(function() {
    console.log('Bugs loaded');
    localForage.getItem('selected_bug', function(id) {
      if (id) {
        localForage.getItem(id, function(bug) {
          if (bug) {
            console.log('selected bug:', bug.id);
            $scope.bug = bug;
            $scope.$apply();
          } else {
            console.warn('selected_bug not available');
          }
        });
      }
    });
  });



  /* Pulls down the comments for some bugs we haven't already
   * done so for.
   * This basically makes it more prepared so that clicking on
   * a bug you haven't already clicked on already has some of the content.
   * */
  var _downloaded_comments = 0;
  function downloadSomeComments() {
    console.log('Hmm... what to download?', _downloaded_comments);
    if (_downloaded_comments > MAX_BACKGROUND_DOWNLOADS) {
      $scope.loaders.fetching_comments = false;
      return;  // we've pre-emptively downloaded too much
    }

    var _downloading = false;
    // we want to do this to the most recent bugs first
    _.each(_.sortBy($scope.bugs, lastChangeTimeSorter).reverse(), function(bug, index) {
      if (!_downloading && bug.comments == null) {
        _downloading = true;
        _downloaded_comments++;
        console.log("FETCH", bug.id);
        $scope.loaders.fetching_comments = true;
        fetchAndUpdateComments(bug, downloadSomeComments);
      }
    });
    if (!_downloading) {
      // there was nothing more to pre-emptively download
      $scope.loaders.fetching_comments = false;
    }
  }

  // the selected bug
  $scope.bug = {
     empty: true
  };

  $scope.selectBug = function(bug) {
    $scope.in_config = false; // in case
    bug.empty = false;
    bug.unread = false;
    localForage.setItem('selected_bug', bug.id);
    fetchAndUpdateComments(bug);
    console.dir(bug);
    $scope.bug = bug;
  };

  $scope.isSelectedBug = function(bug) {
    return bug.id == $scope.bug.id;
  };

  $scope.avatarURL = function(email, size) {
    size = size || 64;
    var secure = document.location.protocol === 'https:';
    if (email === 'mozilla+bugcloser@davedash.com') {
      return 'static/images/bugzilla-icon.png';
    }
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
    localForage.clear(function() {
      loadBugs();
    });
  };

  $scope.makeBugzillaLink = function(id, comment_index) {
    return 'https://bugzilla.mozilla.org/show_bug.cgi?id=' + id;
  };

  $scope.hasAdditionalComments = function(bug) {
    return bug.comments != null && bug.comments.length > 1;
  };

  $scope.countAdditionalComments = function(bug) {
    return bug.comments.length - 1;
  };

  $scope.showFileSize = function(bytes) {
    return filesize(bytes);
  };

  $scope.refreshBugs = function() {
    $scope.loaders.refreshing_bugs = true;
    fetchAndUpdateBugs(function() {
      $scope.loaders.refreshing_bugs = false;
    });
    //loadBugs(true, function() {
    //  $scope.loaders.refreshing_bugs = false;
    //});
  };

  $scope.refreshBug = function(bug) {
    $scope.loaders.refreshing_bug = true;
    fetchAndUpdateBug(bug, function() {
      fetchAndUpdateComments(bug, function() {
        $scope.bug = bug;
        $scope.loaders.refreshing_bug = false;
      });
    });
  };

}
