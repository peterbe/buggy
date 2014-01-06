/* A concoction between angular's $scope and localForage
 *
 * Instead of doing::
 *
 * MyController($scope) {
 *   localForage.getItem('key', function(value) {
 *     $scope.key = value;
 *     $scope.$apply();
 *   });
 * }
 *
 * You instead do this::
 *
 * MyController($scope) {
 *   angularForage.getItem($scope, 'key', function(value) {
 *     $scope.key = value;
 *   });
 * }
 *
 * The above example isn't a big win in terms of lines-of-code but it avoids the
 * dreaded `$scope.$apply` in your code. Also, this means you don't have to remember
 * to call `$scope.$apply()` if you pass this callback further away.
 *
 * NB: An advantage is that when doing `$scope.$apply()` NOT in a function
 * you can lose some context on possible errors which makes it harder to debug.
 *
 */
(function() {

  function getItem($scope, key, callback) {
    localForage.getItem(key, function(v) {
      $scope.$apply(function() {
        callback(v);
      });
    });
  }

  function setItem($scope, key, value, callback) {
    localForage.setItem(key, value, function() {
      if (callback) $scope.$apply(callback);
    });
  }

  function removeItem($scope, key, callback) {
    localForage.removeItem(key, function() {
      if (callback) $scope.$apply(callback);
    });
  }

  function clear($scope, callback) {
    localForage.clear(function(v) {
      if (callback) $scope.$apply(callback);
    });
  }

  function length($scope, callback) {
    localForage.length(function(v) {
      $scope.$apply(function() {
        callback(v);
      });
    });
  }

  function key($scope, n, callback) {
    localForage.key(n, function(v) {
      $scope.$apply(function() {
        callback(v);
      });
    });
  }

  var angularForage = {
    getItem: getItem,
    setItem: setItem,
    removeItem: removeItem,
    clear: clear,
    length: length,
    key: key
  };

  if(typeof define === 'function' && define.amd) {
    define(function() { return angularForage; });
  } else if(typeof module !== 'undefined' && module.exports) {
    module.exports = angularForage;
  } else {
    this.angularForage = angularForage;
  }


}).call(this);
