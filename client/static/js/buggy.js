/*global: get_gravatar, serializeObject, filesize */

'use strict';

var BUGZILLA_URL = 'https://api-dev.bugzilla.mozilla.org/1.3/';
var MAX_BACKGROUND_DOWNLOADS = 5;

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

var app = angular.module('buggyApp', ['ngSanitize']);

app.filter('stringArraySort', function() {
  return function(input) {
    return input.sort();
  }
});

app.directive('whenScrolled', function() {
  return function(scope, elm, attr) {
    var raw = elm[0];
    var funCheckBounds = function(evt) {
      //console.log("event fired: " + evt.type);
      var rectObject = raw.getBoundingClientRect();
      //console.log(rectObject.bottom, window.innerHeight);
      if (rectObject.bottom < window.innerHeight) {
        //console.log('**At the bottom');
        scope.$apply(attr.whenScrolled);
      }

    };
    angular.element(window).bind('scroll load', funCheckBounds);
  };
});

BugsController.$inject = ['$scope', '$http'];

function BugsController($scope, $http) {

  $scope.bugs = [];
  $scope.list_limit = 40;
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
  $scope.products = [];
  $scope.loaders = {
     fetching_bugs: false,
     fetching_comments: false,
     refreshing_bug: false,
     refreshing_bugs: false,
     finding_products: false,
     downloading_configuration: false
  };

  $scope.errors = {
    update_comments: false,
    finding_products: false
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

  function fetchConfiguration(params) {
    var url = BUGZILLA_URL + 'configuration';
    //url += '?' + serializeObject(params);
    console.log("BUGZILLA URL", url);
    return $http.get(url);
  }

  function lastChangeTimeSorter(bug) {
    return bug.last_change_time;
  }
  //$scope.lastChangeTimeSorter = lastChangeTimeSorter;
  $scope.lastChangeTimeSorter = function(bug) {
    return bug.last_change_time;
  }

  function fetchAndUpdateBugs(callback) {
    var _count_products = $scope.products;
    _.each($scope.products, function(product_combo, index) {
      _count_products--;
      var params = {
         include_fields: _INCLUDE_FIELDS
      };
      var product, component;
      if (product_combo.split('::').length === 2) {
        params.product = product_combo.split('::')[0].trim();
        params.component = product_combo.split('::')[1].trim();
      } else {
        params.product = product_combo.trim();
      }
      $scope.bugs = [];
      fetchBugs(params)
        .success(function(data, status, headers, config) {
          console.log('Success');
          //console.dir(data);
          $scope.data_downloaded += JSON.stringify(data).length;
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
              if (!_count_to_pull && !_count_products) {
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
          console.warn('Failure');
          console.dir(data);
        });
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
      console.warn('Failure to update bug');
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
        //console.log('Comments Success');
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

  function loadProducts() {
    localForage.getItem('products', function(value) {
      if (value != null && value.length) {
        $scope.products = value;
      }
    });
  }
  loadProducts();


  /* Pulls bugs from local storage and if nothing's there,
   * fetch it remotely */
  function loadBugs(callback) {
    localForage.getItem('bugs', function(value) {
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
              console.log('Done loading bugs. Start downloading some comments.');
              downloadSomeComments();
              if (callback) callback();
            }
          });
        });
      } else {
        // need to fetch remotely
        if ($scope.products.length) {
          $scope.loaders.fetching_bugs = true;
          console.log("Start fetchAndUpdateBugs()");
          fetchAndUpdateBugs(function() {
            $scope.loaders.fetching_bugs = false;
            // start pulling down comments pre-emptively
            downloadSomeComments();
            if (callback) callback();
          });
        }
      }
    });
  };


  // the very first thing to do
  loadBugs(function() {
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
    if (_downloaded_comments > MAX_BACKGROUND_DOWNLOADS) {
      $scope.loaders.fetching_comments = false;
      return;  // we've pre-emptively downloaded too much
    }
    console.log('Hmm... what to download?', _downloaded_comments);

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
    //console.dir(bug);
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
    console.log('Start refreshing bugs');
    $scope.products_changed = false;
    $scope.loaders.refreshing_bugs = true;
    fetchAndUpdateBugs(function() {
      $scope.loaders.refreshing_bugs = false;
    });
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

  $scope.loadMore = function() {
    $scope.list_limit *= 2;
    console.log("Limit to", $scope.list_limit);

    _downloaded_comments = 0;  // reset this so we can load more
    console.log('in loadMore()');
    downloadSomeComments();
  };

  $scope.canLoadMore = function() {
    return $scope.bugs.length > $scope.list_limit;
  };

  function findProductsByEmail(email, callback) {
    var params = {
      include_fields: 'product,component',
      email1: email,
      email1_assigned_to: 1,
      //email1_qa_contact: 1,
      //email1_creator: 1
    };
    fetchBugs(params)
      .success(function(data, status, headers, config) {
        _.each(data.bugs, function(bug) {
          var combo = bug.product + ' :: ' + bug.component;
          if (!_.contains($scope.products, combo)) {
            $scope.products.push(combo);
          }
        });
        if (callback) callback();
      }).error(function(data, status, headers, config) {
        console.warn('Failure');
        console.dir(data);
        $scope.errors.finding_products = true;
        if (callback) callback();
      });
  }

  $scope.removeProduct = function(combo) {
    $scope.products = _.filter($scope.products, function(p) {
      return p !== combo;
    });
    localForage.setItem('products', $scope.products);
    $scope.products_changed = true;
  };

  $scope.email_search = '';
  $scope.searchProductsByEmail = function() {
    if (this.email_search && this.email_search.trim()) {
      console.log('Search by', this.email_search);
      $scope.loaders.finding_products = true;
      findProductsByEmail(this.email_search, function() {
        $scope.loaders.finding_products = false;
        if ($scope.products.length) {
          localForage.setItem('products', $scope.products);
          $scope.products_changed = true;
        }
      });
    }
  };

  $scope.listScrolled = function() {
    if (_downloaded_comments) {
      _downloaded_comments = 0;
      downloadSomeComments();
    }
  };

  $scope.addProduct = function() {
    console.log('ADD', this.product_choice);
    $scope.products.push(this.product_choice);
    $scope.products_changed = true;
  };

  var _downloading_configuration = false;
  $scope.product_choices = ['Be patient. It takes a while to download all options.'];
  $scope.product_choice = null;
  $scope.startSelectProducts = function() {
    if (_downloading_configuration) return;
    $scope.loaders.downloading_configuration = true;
    _downloading_configuration = true;
    fetchConfiguration()
      .success(function(data) {
        $scope.loaders.downloading_configuration = false;
        $scope.product_choices = [];
        console.dir(data.product);
        var all = [];
        for (var product_name in data.product) {
          all.push(product_name);
          for (var component_name in data.product[product_name].component) {
            all.push(product_name + ' :: ' + component_name);
          }
        }
        all.sort();
        console.dir(all);
        $scope.product_choices = all;
      }).error(function() {
        console.warn('Unable to download configuration');
      });
  };

}
