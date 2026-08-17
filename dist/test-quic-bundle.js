var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod2) => function __require() {
  try {
    return mod2 || (0, cb[__getOwnPropNames(cb)[0]])((mod2 = { exports: {} }).exports, mod2), mod2.exports;
  } catch (e) {
    throw mod2 = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod2, isNodeMode, target) => (target = mod2 != null ? __create(__getProtoOf(mod2)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod2 || !mod2.__esModule ? __defProp(target, "default", { value: mod2, enumerable: true }) : target,
  mod2
));

// node_modules/flat-ranges/index.js
var require_flat_ranges = __commonJS({
  "node_modules/flat-ranges/index.js"(exports, module) {
    (function(root, factory) {
      if (typeof exports === "object" && typeof module !== "undefined") {
        var api = factory();
        module.exports = api;
        module.exports.default = api;
      } else if (typeof define === "function" && define.amd) {
        define(factory);
      } else {
        root.flatRanges = factory();
      }
    })(typeof self !== "undefined" ? self : exports, function() {
      function addOne(ranges, from, to) {
        if (from >= to) return false;
        var n = ranges.length;
        if (n === 0) {
          ranges.push(from, to);
          return true;
        }
        var lo = 0, hi = n >> 1;
        while (lo < hi) {
          var mid = lo + hi >> 1;
          if (ranges[(mid << 1) + 1] < from) lo = mid + 1;
          else hi = mid;
        }
        var mergeStart = lo;
        lo = mergeStart;
        hi = n >> 1;
        while (lo < hi) {
          var mid = lo + hi >> 1;
          if (ranges[mid << 1] <= to) lo = mid + 1;
          else hi = mid;
        }
        var mergeEnd = lo;
        if (mergeStart === mergeEnd) {
          var ins = mergeStart << 1;
          ranges.length = n + 2;
          for (var i = n + 1; i >= ins + 2; i--) {
            ranges[i] = ranges[i - 2];
          }
          ranges[ins] = from;
          ranges[ins + 1] = to;
          return true;
        }
        var ms2 = mergeStart << 1;
        var newFrom = from < ranges[ms2] ? from : ranges[ms2];
        var me2 = (mergeEnd - 1 << 1) + 1;
        var newTo = to > ranges[me2] ? to : ranges[me2];
        if (mergeEnd - mergeStart === 1 && newFrom === ranges[ms2] && newTo === ranges[ms2 + 1]) {
          return false;
        }
        ranges[ms2] = newFrom;
        ranges[ms2 + 1] = newTo;
        var removeCount = mergeEnd - mergeStart - 1 << 1;
        if (removeCount > 0) {
          var dst = ms2 + 2;
          var src = mergeEnd << 1;
          while (src < n) {
            ranges[dst++] = ranges[src++];
          }
          ranges.length = n - removeCount;
        }
        return true;
      }
      function sortFlat(arr) {
        var pairs = arr.length >> 1;
        var indices = new Array(pairs);
        var count = 0;
        for (var i = 0; i < pairs; i++) {
          if (arr[i << 1] < arr[(i << 1) + 1]) {
            indices[count++] = i;
          }
        }
        indices.length = count;
        indices.sort(function(a, b) {
          return arr[a << 1] - arr[b << 1];
        });
        var sorted = new Array(count << 1);
        for (var i = 0; i < count; i++) {
          var idx = indices[i] << 1;
          sorted[i << 1] = arr[idx];
          sorted[(i << 1) + 1] = arr[idx + 1];
        }
        return sorted;
      }
      function mergeTwoSorted(a, b) {
        var result = [];
        var i = 0, j = 0;
        var na = a.length, nb = b.length;
        var from, to;
        while (i < na || j < nb) {
          if (i < na && (j >= nb || a[i] <= b[j])) {
            from = a[i];
            to = a[i + 1];
            i += 2;
          } else {
            from = b[j];
            to = b[j + 1];
            j += 2;
          }
          if (from >= to) continue;
          if (result.length > 0 && from <= result[result.length - 1]) {
            if (to > result[result.length - 1]) {
              result[result.length - 1] = to;
            }
          } else {
            result.push(from, to);
          }
        }
        return result;
      }
      var ADD_ONE_THRESHOLD = 12;
      function add3(ranges, newRanges) {
        if (newRanges.length === 0) return false;
        if (newRanges.length === 2) {
          return addOne(ranges, newRanges[0], newRanges[1]);
        }
        if (newRanges.length <= ADD_ONE_THRESHOLD) {
          var changed = false;
          for (var i = 0; i < newRanges.length; i += 2) {
            if (addOne(ranges, newRanges[i], newRanges[i + 1])) {
              changed = true;
            }
          }
          return changed;
        }
        var sorted = sortFlat(newRanges);
        var merged = mergeTwoSorted(ranges, sorted);
        var changed = false;
        if (merged.length !== ranges.length) {
          changed = true;
        } else {
          for (var i = 0; i < merged.length; i++) {
            if (merged[i] !== ranges[i]) {
              changed = true;
              break;
            }
          }
        }
        ranges.length = merged.length;
        for (var i = 0; i < merged.length; i++) {
          ranges[i] = merged[i];
        }
        return changed;
      }
      function remove2(ranges, removeRanges) {
        var rn = removeRanges.length;
        if (rn === 0) return false;
        var result = [];
        var n = ranges.length;
        var i = 0, j = 0;
        var changed = false;
        var curFrom, curTo;
        while (i < n && ranges[i] >= ranges[i + 1]) i += 2;
        if (i >= n) return false;
        curFrom = ranges[i];
        curTo = ranges[i + 1];
        i += 2;
        while (j < rn) {
          var bFrom = removeRanges[j];
          var bTo = removeRanges[j + 1];
          if (bFrom >= bTo) {
            j += 2;
            continue;
          }
          if (curTo <= bFrom) {
            result.push(curFrom, curTo);
            while (i < n && ranges[i] >= ranges[i + 1]) i += 2;
            if (i >= n) {
              curFrom = curTo = -1;
              break;
            }
            curFrom = ranges[i];
            curTo = ranges[i + 1];
            i += 2;
          } else if (curFrom >= bTo) {
            j += 2;
          } else {
            changed = true;
            if (curFrom < bFrom) {
              result.push(curFrom, bFrom);
            }
            if (curTo > bTo) {
              curFrom = bTo;
              j += 2;
            } else {
              while (i < n && ranges[i] >= ranges[i + 1]) i += 2;
              if (i >= n) {
                curFrom = curTo = -1;
                break;
              }
              curFrom = ranges[i];
              curTo = ranges[i + 1];
              i += 2;
            }
          }
        }
        if (curFrom < curTo) {
          result.push(curFrom, curTo);
        }
        while (i < n) {
          if (ranges[i] < ranges[i + 1]) {
            result.push(ranges[i], ranges[i + 1]);
          }
          i += 2;
        }
        if (!changed) {
          if (result.length !== n) {
            changed = true;
          } else {
            for (var k = 0; k < result.length; k++) {
              if (ranges[k] !== result[k]) {
                changed = true;
                break;
              }
            }
          }
        }
        ranges.length = result.length;
        for (var k = 0; k < result.length; k++) {
          ranges[k] = result[k];
        }
        return changed;
      }
      function merge2(flatRanges2) {
        var result = [];
        for (var i = 0; i < flatRanges2.length; i += 2) {
          var from = flatRanges2[i];
          var to = flatRanges2[i + 1];
          if (from >= to) continue;
          var rn = result.length;
          if (rn > 0 && from <= result[rn - 1]) {
            if (to > result[rn - 1]) result[rn - 1] = to;
          } else {
            result.push(from, to);
          }
        }
        return result;
      }
      function invert3(ranges, fullStart, fullEnd) {
        var result = [];
        var last = fullStart;
        for (var i = 0; i < ranges.length; i += 2) {
          var from = ranges[i];
          var to = ranges[i + 1];
          if (from >= to) continue;
          if (from > last) result.push(last, from);
          if (to > last) last = to;
        }
        if (last < fullEnd) result.push(last, fullEnd);
        return result;
      }
      function subtract_clip2(baseRanges, subtractRanges) {
        if (baseRanges.length === 0) return subtractRanges.slice();
        if (subtractRanges.length === 0) return [];
        var copy = subtractRanges.slice();
        remove2(copy, baseRanges);
        return copy;
      }
      function length2(ranges) {
        var total = 0;
        for (var i = 0; i < ranges.length; i += 2) {
          var span = ranges[i + 1] - ranges[i];
          if (span > 0) total += span;
        }
        return total;
      }
      function contains2(ranges, value) {
        var pairs = ranges.length >> 1;
        if (pairs === 0) return false;
        var lo = 0, hi = pairs - 1;
        while (lo < hi) {
          var mid = lo + hi + 1 >> 1;
          if (ranges[mid << 1] <= value) lo = mid;
          else hi = mid - 1;
        }
        var idx = lo << 1;
        return ranges[idx] <= value && value < ranges[idx + 1];
      }
      function unknown2(have_ranges, not_have_ranges, min, max) {
        var all = mergeTwoSorted(have_ranges, not_have_ranges);
        return invert3(all, min, max);
      }
      function add_have2(knownHave, knownNotHave, newHave) {
        if (newHave.length === 0) return false;
        var clean3 = subtract_clip2(knownNotHave, newHave);
        if (clean3.length === 0) return false;
        return add3(knownHave, clean3);
      }
      function add_not_have2(knownHave, knownNotHave, newNotHave) {
        if (newNotHave.length === 0) return false;
        var clean3 = subtract_clip2(knownHave, newNotHave);
        if (clean3.length === 0) return false;
        return add3(knownNotHave, clean3);
      }
      function set_have2(knownHave, knownNotHave, newHave) {
        var changed = false;
        var combined = mergeTwoSorted(knownHave, knownNotHave);
        remove2(combined, newHave);
        if (combined.length !== knownNotHave.length) {
          changed = true;
        } else {
          for (var i = 0; i < combined.length; i++) {
            if (combined[i] !== knownNotHave[i]) {
              changed = true;
              break;
            }
          }
        }
        knownNotHave.length = combined.length;
        for (var i = 0; i < combined.length; i++) knownNotHave[i] = combined[i];
        var tmp = [];
        add3(tmp, newHave);
        if (tmp.length !== knownHave.length) {
          changed = true;
        } else {
          for (var i = 0; i < tmp.length; i++) {
            if (tmp[i] !== knownHave[i]) {
              changed = true;
              break;
            }
          }
        }
        knownHave.length = tmp.length;
        for (var i = 0; i < tmp.length; i++) knownHave[i] = tmp[i];
        return changed;
      }
      function set_not_have2(knownHave, knownNotHave, newNotHave) {
        var changed = false;
        var combined = mergeTwoSorted(knownHave, knownNotHave);
        remove2(combined, newNotHave);
        if (combined.length !== knownHave.length) {
          changed = true;
        } else {
          for (var i = 0; i < combined.length; i++) {
            if (combined[i] !== knownHave[i]) {
              changed = true;
              break;
            }
          }
        }
        knownHave.length = combined.length;
        for (var i = 0; i < combined.length; i++) knownHave[i] = combined[i];
        var tmp = [];
        add3(tmp, newNotHave);
        if (tmp.length !== knownNotHave.length) {
          changed = true;
        } else {
          for (var i = 0; i < tmp.length; i++) {
            if (tmp[i] !== knownNotHave[i]) {
              changed = true;
              break;
            }
          }
        }
        knownNotHave.length = tmp.length;
        for (var i = 0; i < tmp.length; i++) knownNotHave[i] = tmp[i];
        return changed;
      }
      return {
        add: add3,
        remove: remove2,
        merge: merge2,
        invert: invert3,
        subtract_clip: subtract_clip2,
        length: length2,
        contains: contains2,
        unknown: unknown2,
        add_have: add_have2,
        add_not_have: add_not_have2,
        set_have: set_have2,
        set_not_have: set_not_have2
      };
    });
  }
});

// node_modules/flat-ranges/index.mjs
var import_index = __toESM(require_flat_ranges(), 1);
var flat_ranges_default = import_index.default;
var add = import_index.default.add;
var remove = import_index.default.remove;
var merge = import_index.default.merge;
var invert = import_index.default.invert;
var subtract_clip = import_index.default.subtract_clip;
var length = import_index.default.length;
var contains = import_index.default.contains;
var unknown = import_index.default.unknown;
var add_have = import_index.default.add_have;
var add_not_have = import_index.default.add_not_have;
var set_have = import_index.default.set_have;
var set_not_have = import_index.default.set_not_have;

// node_modules/quico/src/utils.js
var DEBUG = !!(typeof process !== "undefined" && process.env && process.env.QUICO_DEBUG);
function Emitter() {
  var listeners = {};
  return {
    on: function(name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
    },
    off: function(name, fn) {
      var arr = listeners[name];
      if (arr) {
        var idx = arr.indexOf(fn);
        if (idx !== -1) arr.splice(idx, 1);
      }
    },
    emit: function(name) {
      var args = Array.prototype.slice.call(arguments, 1);
      var arr = listeners[name] || [];
      for (var i = 0; i < arr.length; i++) {
        try {
          arr[i].apply(null, args);
        } catch (e) {
        }
      }
    }
  };
}
function writeVarInt(value) {
  if (value < 64) {
    return new Uint8Array([value]);
  }
  if (value < 16384) {
    return new Uint8Array([
      64 | value >> 8,
      value & 255
    ]);
  }
  if (value < 1073741824) {
    return new Uint8Array([
      128 | value >> 24,
      value >> 16 & 255,
      value >> 8 & 255,
      value & 255
    ]);
  }
  if (value <= Number.MAX_SAFE_INTEGER) {
    var hi = Math.floor(value / 2 ** 32);
    var lo = value >>> 0;
    return new Uint8Array([
      192 | hi >> 24,
      hi >> 16 & 255,
      hi >> 8 & 255,
      hi & 255,
      lo >> 24 & 255,
      lo >> 16 & 255,
      lo >> 8 & 255,
      lo & 255
    ]);
  }
  throw new Error("Value too large for QUIC VarInt");
}
function readVarInt(array, offset) {
  if (offset >= array.length) return null;
  var first = array[offset];
  var prefix = first >> 6;
  if (prefix === 0) {
    return { value: first & 63, byteLength: 1 };
  }
  if (prefix === 1) {
    if (offset + 1 >= array.length) return null;
    return {
      value: (first & 63) << 8 | array[offset + 1],
      byteLength: 2
    };
  }
  if (prefix === 2) {
    if (offset + 3 >= array.length) return null;
    return {
      value: ((first & 63) << 24 | array[offset + 1] << 16 | array[offset + 2] << 8 | array[offset + 3]) >>> 0,
      byteLength: 4
    };
  }
  if (prefix === 3) {
    if (offset + 7 >= array.length) return null;
    var hi = ((first & 63) << 24 | array[offset + 1] << 16 | array[offset + 2] << 8 | array[offset + 3]) >>> 0;
    var lo = (array[offset + 4] << 24 | array[offset + 5] << 16 | array[offset + 6] << 8 | array[offset + 7]) >>> 0;
    var full = BigInt(hi) * 4294967296n + BigInt(lo);
    return { value: Number(full), byteLength: 8 };
  }
  return null;
}
function concatUint8Arrays(arrays) {
  var totalLength = 0;
  for (var i = 0; i < arrays.length; i++) {
    totalLength += arrays[i].length;
  }
  var result = new Uint8Array(totalLength);
  var offset = 0;
  for (var i = 0; i < arrays.length; i++) {
    result.set(arrays[i], offset);
    offset += arrays[i].length;
  }
  return result;
}
function uint8Equal(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.byteLength !== b.byteLength) return false;
  for (var i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
function ack_frame_to_ranges(ackFrame) {
  var flat = [];
  if (!ackFrame || ackFrame.type !== "ack") return flat;
  var largest = Number(ackFrame.largest);
  var firstRange = Number(ackFrame.firstRange);
  if (!isFinite(largest) || !isFinite(firstRange)) return flat;
  var rangesDesc = [];
  var rangeEnd = largest;
  var rangeStart = rangeEnd - firstRange;
  if (rangeStart <= rangeEnd) {
    rangesDesc.push([rangeStart, rangeEnd]);
  }
  var more = ackFrame.ranges || [];
  var prevStart = rangeStart;
  for (var i = 0; i < more.length; i++) {
    var gap = Number(more[i].gap);
    var length2 = Number(more[i].length);
    if (!isFinite(gap) || !isFinite(length2)) continue;
    rangeEnd = prevStart - gap - 2;
    rangeStart = rangeEnd - length2;
    if (rangeStart <= rangeEnd) {
      rangesDesc.push([rangeStart, rangeEnd]);
      prevStart = rangeStart;
    }
  }
  rangesDesc.sort(function(a, b) {
    return a[0] - b[0];
  });
  var merged = [];
  for (var j = 0; j < rangesDesc.length; j++) {
    var s = rangesDesc[j][0], e = rangesDesc[j][1];
    if (merged.length === 0) {
      merged.push([s, e]);
    } else {
      var last = merged[merged.length - 1];
      if (s <= last[1] + 1) {
        if (e > last[1]) last[1] = e;
      } else {
        merged.push([s, e]);
      }
    }
  }
  for (var k = 0; k < merged.length; k++) {
    flat.push(merged[k][0], merged[k][1]);
  }
  return flat;
}
function ranges_to_ack_frame(flatRanges2, ecnStats, ackDelay) {
  if (!flatRanges2 || flatRanges2.length === 0) return null;
  if (flatRanges2.length % 2 !== 0) throw new Error("flatRanges must be [from,to,...] pairs");
  var ranges = [];
  for (var i = 0; i < flatRanges2.length; i += 2) {
    if (flatRanges2[i + 1] > flatRanges2[i]) {
      ranges.push({ start: flatRanges2[i], end: flatRanges2[i + 1] - 1 });
    }
  }
  if (ranges.length === 0) return null;
  ranges.sort(function(a, b) {
    return b.end - a.end;
  });
  var merged = [ranges[0]];
  for (var i = 1; i < ranges.length; i++) {
    var last = merged[merged.length - 1];
    var curr = ranges[i];
    if (curr.end >= last.start - 1) {
      last.start = Math.min(last.start, curr.start);
    } else {
      merged.push(curr);
    }
  }
  var largest = merged[0].end;
  var firstRange = largest - merged[0].start;
  var ackRanges = [];
  for (var i = 1; i < merged.length; i++) {
    var gap = merged[i - 1].start - merged[i].end - 2;
    var length2 = merged[i].end - merged[i].start;
    ackRanges.push({ gap, length: length2 });
  }
  return {
    type: "ack",
    largest,
    delay: ackDelay || 0,
    firstRange,
    ranges: ackRanges,
    ecn: ecnStats ? {
      ect0: ecnStats.ect0 || 0,
      ect1: ecnStats.ect1 || 0,
      ce: ecnStats.ce || 0
    } : null
  };
}

// scripts/shims/buffer.js
if (typeof Uint8Array !== "undefined") {
  if (!Uint8Array.prototype.copy) {
    Uint8Array.prototype.copy = function(target, targetStart = 0, sourceStart = 0, sourceEnd = this.length) {
      const slice = this.subarray(sourceStart, sourceEnd);
      target.set(slice, targetStart);
      return slice.length;
    };
  }
  if (!Uint8Array.prototype.readUInt32BE) {
    Uint8Array.prototype.readUInt32BE = function(offset = 0) {
      return this[offset] << 24 >>> 0 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
    };
  }
  if (!Uint8Array.prototype.readUInt16BE) {
    Uint8Array.prototype.readUInt16BE = function(offset = 0) {
      return this[offset] << 8 | this[offset + 1];
    };
  }
  if (!Uint8Array.prototype.writeUInt32BE) {
    Uint8Array.prototype.writeUInt32BE = function(val, offset = 0) {
      this[offset] = val >>> 24 & 255;
      this[offset + 1] = val >>> 16 & 255;
      this[offset + 2] = val >>> 8 & 255;
      this[offset + 3] = val & 255;
      return offset + 4;
    };
  }
  if (!Uint8Array.prototype.writeUInt16BE) {
    Uint8Array.prototype.writeUInt16BE = function(val, offset = 0) {
      this[offset] = val >>> 8 & 255;
      this[offset + 1] = val & 255;
      return offset + 2;
    };
  }
  if (!Uint8Array.prototype.toString) {
    Uint8Array.prototype.toString = function(encoding) {
      if (encoding === "hex") {
        return Array.from(this).map((b) => b.toString(16).padStart(2, "0")).join("");
      }
      if (encoding === "base64") {
        let binary = "";
        for (let i = 0; i < this.length; i++) binary += String.fromCharCode(this[i]);
        return btoa(binary);
      }
      return new TextDecoder().decode(this);
    };
  }
}

// node_modules/@noble/hashes/_u64.js
var U32_MASK64 = /* @__PURE__ */ (() => BigInt(2 ** 32 - 1))();
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var fromNumH = (n) => n / 2 ** 32 | 0;
var fromNumL = (n) => n >>> 0;
function setU64FromNum(view, byteOffset, n, isLE2) {
  const h = fromNumH(n);
  const l = fromNumL(n);
  view.setUint32(byteOffset, isLE2 ? l : h, isLE2);
  view.setUint32(byteOffset + 4, isLE2 ? h : l, isLE2);
}
var shrSH = (h, _l, s) => h >>> s;
var shrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
function add2(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;

// node_modules/@noble/hashes/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle = (title) => title ? `"${title}" ` : "";
function anumber(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes(value, length2, title = "") {
  if (isBytes(value) && (length2 === void 0 || value.length === length2))
    return value;
  if (length2 !== void 0)
    anumber(length2, "length");
  const bytes = isBytes(value);
  const ofLen = length2 !== void 0 ? ` of length ${length2}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
function ahash(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new TypeError("expected hash wrapped by utils.createHasher");
  anumber(h.outputLen);
  anumber(h.blockLen);
  if (h.outputLen < 1 || h.blockLen < 1)
    throw new Error("hash blockLen / outputLen must be >= 1");
}
var aobject = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
};
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
function rotl(word, shift) {
  return word << shift | word >>> 32 - shift >>> 0;
}
var hasHexBuiltin = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
function asciiToBase16(ch) {
  return ch >= 48 && ch <= 57 ? ch - 48 : ch >= 65 && ch <= 70 ? ch - (65 - 10) : ch >= 97 && ch <= 102 ? ch - (97 - 10) : void 0;
}
function hexToBytes(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  if (hasHexBuiltin) {
    try {
      return Uint8Array.fromHex(hex);
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new RangeError(error.message);
      throw error;
    }
  }
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new RangeError("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex.charCodeAt(hi));
    const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new RangeError('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
function checkOpts(defaults, opts, title = "opts") {
  aobject(defaults, "defaults");
  if (opts !== void 0)
    aobject(opts, title);
  const merged = Object.assign(defaults, opts);
  return merged;
}
function createHasher(hashCons, info = {}) {
  if (typeof hashCons !== "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info = checkOpts({}, info, "info");
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
function randomBytes(bytesLength = 32) {
  anumber(bytesLength, "bytesLength");
  const cr = typeof globalThis === "object" ? globalThis.crypto : null;
  if (typeof cr?.getRandomValues !== "function")
    throw new Error("crypto.getRandomValues must be defined");
  if (bytesLength > 65536)
    throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
  return cr.getRandomValues(new Uint8Array(bytesLength));
}
var oidNist = (suffix) => ({
  // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
  // Larger suffix values would need base-128 OID encoding and a different length byte.
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// node_modules/@noble/hashes/_md.js
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class {
  blockLen;
  outputLen;
  canXOF = false;
  padOffset;
  isLE;
  // For partial updates less than block size
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE2) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE2;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    let processed = false;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        processed = true;
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
        processed = true;
      }
    }
    this.length += data.length;
    if (processed)
      this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE: isLE2 } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    buffer.fill(0, pos);
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      buffer.fill(0);
    }
    setU64FromNum(view, blockLen - 8, this.length * 8, isLE2);
    this.process(view, 0);
    this.roundClean();
    const oview = out === buffer ? view : createView(out);
    const len = this.outputLen;
    const outLen = len / 4;
    const state = this.get();
    if (len % 4 || outLen > state.length)
      throw new Error("invalid outputLen");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE2);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneIntoMeta(to) {
    const { buffer, length: length2, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length2;
    to.pos = pos;
    if (pos)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
var SHA384_IV = /* @__PURE__ */ Uint32Array.from([
  3418070365,
  3238371032,
  1654270250,
  914150663,
  2438529370,
  812702999,
  355462360,
  4144912697,
  1731405415,
  4290775857,
  2394180231,
  1750603025,
  3675008525,
  1694076839,
  1203062813,
  3204075428
]);
var SHA512_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  4089235720,
  3144134277,
  2227873595,
  1013904242,
  4271175723,
  2773480762,
  1595750129,
  1359893119,
  2917565137,
  2600822924,
  725511199,
  528734635,
  4215389547,
  1541459225,
  327033209
]);

// node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B = class extends HashMD {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  // Numeric initializers matter: starting the fields as `undefined` changes
  // V8's field representation and makes sha256 3x slower (measured).
  A = 0;
  B = 0;
  C = 0;
  D = 0;
  E = 0;
  F = 0;
  G = 0;
  H = 0;
  constructor(outputLen, IV) {
    super(64, outputLen, 8, false);
    this.A = IV[0] | 0;
    this.B = IV[1] | 0;
    this.C = IV[2] | 0;
    this.D = IV[3] | 0;
    this.E = IV[4] | 0;
    this.F = IV[5] | 0;
    this.G = IV[6] | 0;
    this.H = IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor()).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var _SHA256 = class extends SHA2_32B {
  constructor() {
    super(32, SHA256_IV);
  }
};
var K512 = /* @__PURE__ */ (() => split([
  "0x428a2f98d728ae22",
  "0x7137449123ef65cd",
  "0xb5c0fbcfec4d3b2f",
  "0xe9b5dba58189dbbc",
  "0x3956c25bf348b538",
  "0x59f111f1b605d019",
  "0x923f82a4af194f9b",
  "0xab1c5ed5da6d8118",
  "0xd807aa98a3030242",
  "0x12835b0145706fbe",
  "0x243185be4ee4b28c",
  "0x550c7dc3d5ffb4e2",
  "0x72be5d74f27b896f",
  "0x80deb1fe3b1696b1",
  "0x9bdc06a725c71235",
  "0xc19bf174cf692694",
  "0xe49b69c19ef14ad2",
  "0xefbe4786384f25e3",
  "0x0fc19dc68b8cd5b5",
  "0x240ca1cc77ac9c65",
  "0x2de92c6f592b0275",
  "0x4a7484aa6ea6e483",
  "0x5cb0a9dcbd41fbd4",
  "0x76f988da831153b5",
  "0x983e5152ee66dfab",
  "0xa831c66d2db43210",
  "0xb00327c898fb213f",
  "0xbf597fc7beef0ee4",
  "0xc6e00bf33da88fc2",
  "0xd5a79147930aa725",
  "0x06ca6351e003826f",
  "0x142929670a0e6e70",
  "0x27b70a8546d22ffc",
  "0x2e1b21385c26c926",
  "0x4d2c6dfc5ac42aed",
  "0x53380d139d95b3df",
  "0x650a73548baf63de",
  "0x766a0abb3c77b2a8",
  "0x81c2c92e47edaee6",
  "0x92722c851482353b",
  "0xa2bfe8a14cf10364",
  "0xa81a664bbc423001",
  "0xc24b8b70d0f89791",
  "0xc76c51a30654be30",
  "0xd192e819d6ef5218",
  "0xd69906245565a910",
  "0xf40e35855771202a",
  "0x106aa07032bbd1b8",
  "0x19a4c116b8d2d0c8",
  "0x1e376c085141ab53",
  "0x2748774cdf8eeb99",
  "0x34b0bcb5e19b48a8",
  "0x391c0cb3c5c95a63",
  "0x4ed8aa4ae3418acb",
  "0x5b9cca4f7763e373",
  "0x682e6ff3d6b2b8a3",
  "0x748f82ee5defb2fc",
  "0x78a5636f43172f60",
  "0x84c87814a1f0ab72",
  "0x8cc702081a6439ec",
  "0x90befffa23631e28",
  "0xa4506cebde82bde9",
  "0xbef9a3f7b2c67915",
  "0xc67178f2e372532b",
  "0xca273eceea26619c",
  "0xd186b8c721c0c207",
  "0xeada7dd6cde0eb1e",
  "0xf57d4f7fee6ed178",
  "0x06f067aa72176fba",
  "0x0a637dc5a2c898a6",
  "0x113f9804bef90dae",
  "0x1b710b35131c471b",
  "0x28db77f523047d84",
  "0x32caab7b40c72493",
  "0x3c9ebe0a15c9bebc",
  "0x431d67c49c100d4c",
  "0x4cc5d4becb3e42b6",
  "0x597f299cfc657e2a",
  "0x5fcb6fab3ad6faec",
  "0x6c44198c4a475817"
].map((n) => BigInt(n))))();
var SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
var SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
var SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
var SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
var SHA2_64B = class extends HashMD {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  // h -- high 32 bits, l -- low 32 bits
  // Numeric initializers matter: starting the fields as `undefined` changes
  // V8's field representation and slows hashing down (measured on sha256).
  Ah = 0;
  Al = 0;
  Bh = 0;
  Bl = 0;
  Ch = 0;
  Cl = 0;
  Dh = 0;
  Dl = 0;
  Eh = 0;
  El = 0;
  Fh = 0;
  Fl = 0;
  Gh = 0;
  Gl = 0;
  Hh = 0;
  Hl = 0;
  constructor(outputLen, IV) {
    super(128, outputLen, 16, false);
    this.Ah = IV[0] | 0;
    this.Al = IV[1] | 0;
    this.Bh = IV[2] | 0;
    this.Bl = IV[3] | 0;
    this.Ch = IV[4] | 0;
    this.Cl = IV[5] | 0;
    this.Dh = IV[6] | 0;
    this.Dl = IV[7] | 0;
    this.Eh = IV[8] | 0;
    this.El = IV[9] | 0;
    this.Fh = IV[10] | 0;
    this.Fl = IV[11] | 0;
    this.Gh = IV[12] | 0;
    this.Gl = IV[13] | 0;
    this.Hh = IV[14] | 0;
    this.Hl = IV[15] | 0;
  }
  // prettier-ignore
  get() {
    const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
  }
  // prettier-ignore
  set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
    this.Ah = Ah | 0;
    this.Al = Al | 0;
    this.Bh = Bh | 0;
    this.Bl = Bl | 0;
    this.Ch = Ch | 0;
    this.Cl = Cl | 0;
    this.Dh = Dh | 0;
    this.Dl = Dl | 0;
    this.Eh = Eh | 0;
    this.El = El | 0;
    this.Fh = Fh | 0;
    this.Fl = Fl | 0;
    this.Gh = Gh | 0;
    this.Gl = Gl | 0;
    this.Hh = Hh | 0;
    this.Hl = Hl | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor()).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4) {
      SHA512_W_H[i] = view.getUint32(offset);
      SHA512_W_L[i] = view.getUint32(offset += 4);
    }
    for (let i = 16; i < 80; i++) {
      const W15h = SHA512_W_H[i - 15] | 0;
      const W15l = SHA512_W_L[i - 15] | 0;
      const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
      const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
      const W2h = SHA512_W_H[i - 2] | 0;
      const W2l = SHA512_W_L[i - 2] | 0;
      const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
      const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
      const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
      const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
      SHA512_W_H[i] = SUMh | 0;
      SHA512_W_L[i] = SUMl | 0;
    }
    let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    for (let i = 0; i < 80; i++) {
      const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
      const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
      const CHIh = Eh & Fh ^ ~Eh & Gh;
      const CHIl = El & Fl ^ ~El & Gl;
      const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
      const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
      const T1l = T1ll | 0;
      const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
      const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
      const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
      const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
      Hh = Gh | 0;
      Hl = Gl | 0;
      Gh = Fh | 0;
      Gl = Fl | 0;
      Fh = Eh | 0;
      Fl = El | 0;
      ({ h: Eh, l: El } = add2(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
      Dh = Ch | 0;
      Dl = Cl | 0;
      Ch = Bh | 0;
      Cl = Bl | 0;
      Bh = Ah | 0;
      Bl = Al | 0;
      const All = add3L(T1l, sigma0l, MAJl);
      Ah = add3H(All, T1h, sigma0h, MAJh);
      Al = All | 0;
    }
    ({ h: Ah, l: Al } = add2(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
    ({ h: Bh, l: Bl } = add2(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
    ({ h: Ch, l: Cl } = add2(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
    ({ h: Dh, l: Dl } = add2(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
    ({ h: Eh, l: El } = add2(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
    ({ h: Fh, l: Fl } = add2(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
    ({ h: Gh, l: Gl } = add2(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
    ({ h: Hh, l: Hl } = add2(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
    this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
  }
  roundClean() {
    clean(SHA512_W_H, SHA512_W_L);
  }
  destroy() {
    this.destroyed = true;
    clean(this.buffer);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
};
var _SHA512 = class extends SHA2_64B {
  constructor() {
    super(64, SHA512_IV);
  }
};
var _SHA384 = class extends SHA2_64B {
  constructor() {
    super(48, SHA384_IV);
  }
};
var sha256 = /* @__PURE__ */ createHasher(
  () => new _SHA256(),
  /* @__PURE__ */ oidNist(1)
);
var sha512 = /* @__PURE__ */ createHasher(
  () => new _SHA512(),
  /* @__PURE__ */ oidNist(3)
);
var sha384 = /* @__PURE__ */ createHasher(
  () => new _SHA384(),
  /* @__PURE__ */ oidNist(2)
);

// node_modules/@noble/hashes/legacy.js
var SHA1_IV = /* @__PURE__ */ Uint32Array.from([
  1732584193,
  4023233417,
  2562383102,
  271733878,
  3285377520
]);
var SHA1_W = /* @__PURE__ */ new Uint32Array(80);
var _SHA1 = class extends HashMD {
  A = SHA1_IV[0] | 0;
  B = SHA1_IV[1] | 0;
  C = SHA1_IV[2] | 0;
  D = SHA1_IV[3] | 0;
  E = SHA1_IV[4] | 0;
  constructor() {
    super(64, 20, 8, false);
  }
  get() {
    const { A, B, C, D, E } = this;
    return [A, B, C, D, E];
  }
  set(A, B, C, D, E) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor()).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA1_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 80; i++)
      SHA1_W[i] = rotl(SHA1_W[i - 3] ^ SHA1_W[i - 8] ^ SHA1_W[i - 14] ^ SHA1_W[i - 16], 1);
    let { A, B, C, D, E } = this;
    for (let i = 0; i < 80; i++) {
      let F, K2;
      if (i < 20) {
        F = Chi(B, C, D);
        K2 = 1518500249;
      } else if (i < 40) {
        F = B ^ C ^ D;
        K2 = 1859775393;
      } else if (i < 60) {
        F = Maj(B, C, D);
        K2 = 2400959708;
      } else {
        F = B ^ C ^ D;
        K2 = 3395469782;
      }
      const T = rotl(A, 5) + F + E + K2 + SHA1_W[i] | 0;
      E = D;
      D = C;
      C = rotl(B, 30);
      B = A;
      A = T;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    this.set(A, B, C, D, E);
  }
  roundClean() {
    clean(SHA1_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var sha1 = /* @__PURE__ */ createHasher(() => new _SHA1());
var p32 = /* @__PURE__ */ Math.pow(2, 32);
var K = /* @__PURE__ */ Array.from({ length: 64 }, (_, i) => Math.floor(p32 * Math.abs(Math.sin(i + 1))));
var MD5_IV = /* @__PURE__ */ SHA1_IV.slice(0, 4);
var MD5_W = /* @__PURE__ */ new Uint32Array(16);
var MD5_SHIFTS = /* @__PURE__ */ (() => {
  const S = [
    [7, 12, 17, 22],
    [5, 9, 14, 20],
    [4, 11, 16, 23],
    [6, 10, 15, 21]
  ];
  return Uint8Array.from({ length: 64 }, (_, i) => S[Math.floor(i / 16)][i % 4]);
})();
var _MD5 = class extends HashMD {
  A = MD5_IV[0] | 0;
  B = MD5_IV[1] | 0;
  C = MD5_IV[2] | 0;
  D = MD5_IV[3] | 0;
  constructor() {
    super(64, 16, 8, true);
  }
  get() {
    const { A, B, C, D } = this;
    return [A, B, C, D];
  }
  set(A, B, C, D) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor()).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      MD5_W[i] = view.getUint32(offset, true);
    let { A, B, C, D } = this;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) {
        F = Chi(B, C, D);
        g = i;
      } else if (i < 32) {
        F = Chi(D, B, C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = 7 * i % 16;
      }
      F = F + A + K[i] + MD5_W[g];
      A = D;
      D = C;
      C = B;
      B = B + rotl(F, MD5_SHIFTS[i]);
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    this.set(A, B, C, D);
  }
  roundClean() {
    clean(MD5_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0);
    clean(this.buffer);
  }
};
var md5 = /* @__PURE__ */ createHasher(() => new _MD5());

// node_modules/@noble/hashes/hmac.js
var _HMAC = class {
  oHash;
  iHash;
  blockLen;
  outputLen;
  canXOF = false;
  finished = false;
  destroyed = false;
  constructor(hash, key) {
    ahash(hash);
    abytes(key, void 0, "key");
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("expected Hash instance");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash.create();
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54 ^ 92;
    this.oHash.update(pad);
    clean(pad);
  }
  update(buf) {
    aexists(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const buf = out.subarray(0, this.outputLen);
    this.iHash.digestInto(buf);
    this.oHash.update(buf);
    this.oHash.digestInto(buf);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to ||= Object.create(Object.getPrototypeOf(this), {});
    const { oHash, iHash, finished, destroyed, blockLen, outputLen, canXOF } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.canXOF = canXOF;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
};
var hmac = /* @__PURE__ */ (() => {
  const hmac_ = ((hash, key, message) => new _HMAC(hash, key).update(message).digest());
  hmac_.create = (hash, key) => new _HMAC(hash, key);
  return hmac_;
})();

// node_modules/@noble/ciphers/utils.js
function isBytes2(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle2 = (title) => title ? `"${title}" ` : "";
function abool(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle2(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function anumber2(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle2(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle2(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes2(value, length2, title = "") {
  if (isBytes2(value) && (length2 === void 0 || value.length === length2))
    return value;
  if (length2 !== void 0)
    anumber2(length2, "length");
  const bytes = isBytes2(value);
  const ofLen = length2 !== void 0 ? ` of length ${length2}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle2(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
var aobject2 = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(label === "object" ? "expected valid options object" : `"${label}" expected object, got type=${typeof value}`);
};
function aexists2(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput2(out, instance) {
  abytes2(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function aoutput32(out, instance) {
  aoutput2(out, instance);
  if (!isAligned32(out))
    throw new Error("invalid output, must be aligned");
}
function u8(arr) {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean2(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView2(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
var swap8IfBE = isLE ? (n) => n : (n) => byteSwap(n) >>> 0;
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
  return arr;
}
var swap32IfBE = isLE ? (u) => u : byteSwap32;
function overlapBytes(a, b) {
  if (!a.byteLength || !b.byteLength)
    return false;
  return a.buffer === b.buffer && // best we can do, may fail with an obscure Proxy
  a.byteOffset < b.byteOffset + b.byteLength && // a starts before b end
  b.byteOffset < a.byteOffset + a.byteLength;
}
function complexOverlapBytes(input, output) {
  if (overlapBytes(input, output) && input.byteOffset < output.byteOffset)
    throw new Error("complex overlap of input and output is not supported");
}
function checkOpts2(defaults, opts) {
  aobject2(defaults, "defaults");
  aobject2(opts, "opts");
  const merged = Object.assign(defaults, opts);
  return merged;
}
function equalBytes(a, b) {
  a = abytes2(a);
  b = abytes2(b);
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function wrapMacConstructor(keyLen, macCons, fromMsg) {
  const mac = macCons;
  const getArgs = fromMsg || (() => []);
  const macC = (msg, key) => mac(key, ...getArgs(msg)).update(msg).digest();
  const tmp = mac(new Uint8Array(keyLen), ...getArgs(new Uint8Array(0)));
  macC.outputLen = tmp.outputLen;
  macC.blockLen = tmp.blockLen;
  macC.create = (key, ...args) => mac(key, ...args);
  return macC;
}
var wrapCipher = /* @__NO_SIDE_EFFECTS__ */ (params, constructor) => {
  function wrappedCipher(key, ...args) {
    abytes2(key, void 0, "key");
    if (params.nonceLength !== void 0) {
      const nonce = args[0];
      abytes2(nonce, params.varSizeNonce ? void 0 : params.nonceLength, "nonce");
    }
    const tagl = params.tagLength;
    const aadStart = params.nonceLength !== void 0 ? 1 : 0;
    if (!params.withAAD) {
      for (let i = aadStart; i < args.length; i++)
        if (isBytes2(args[i]))
          throw new Error("AAD not supported");
    }
    if (params.withAAD && args[aadStart] !== void 0)
      abytes2(args[aadStart], void 0, "AAD");
    const cipher = constructor(key, ...args);
    const checkOutput = (fnLength, output) => {
      if (output !== void 0) {
        if (fnLength !== 2)
          throw new Error("cipher output not supported");
        abytes2(output, void 0, "output");
      }
    };
    let called = false;
    const wrCipher = {
      encrypt(data, output) {
        if (called)
          throw new Error("cannot encrypt() twice with same key + nonce");
        called = true;
        abytes2(data, void 0, "data");
        checkOutput(cipher.encrypt.length, output);
        return cipher.encrypt(data, output);
      },
      decrypt(data, output) {
        abytes2(data, void 0, "data");
        if (tagl && data.length < tagl)
          throw new Error('"ciphertext" expected length >= tagLength=' + tagl);
        checkOutput(cipher.decrypt.length, output);
        return cipher.decrypt(data, output);
      }
    };
    return wrCipher;
  }
  Object.assign(wrappedCipher, params);
  return wrappedCipher;
};
function getOutput(expectedLength, out, onlyAligned = true) {
  if (out === void 0)
    return new Uint8Array(expectedLength);
  abytes2(out, expectedLength, "output");
  if (onlyAligned && !isAligned32(out))
    throw new Error("invalid output, must be aligned");
  return out;
}
function u64Lengths(dataLength, aadLength, isLE2) {
  anumber2(dataLength);
  anumber2(aadLength);
  abool(isLE2);
  const num = new Uint8Array(16);
  const view = createView2(num);
  view.setBigUint64(0, BigInt(aadLength), isLE2);
  view.setBigUint64(8, BigInt(dataLength), isLE2);
  return num;
}
function isAligned32(bytes) {
  return bytes.byteOffset % 4 === 0;
}
function copyBytes(bytes) {
  return Uint8Array.from(abytes2(bytes));
}

// node_modules/@noble/ciphers/_polyval.js
var BLOCK_SIZE = 16;
var ZEROS16 = /* @__PURE__ */ new Uint8Array(16);
var ZEROS32 = /* @__PURE__ */ u32(ZEROS16);
var POLY = 225;
var mul2 = (s0, s1, s2, s3) => {
  const hiBit = s3 & 1;
  return {
    s3: s2 << 31 | s3 >>> 1,
    s2: s1 << 31 | s2 >>> 1,
    s1: s0 << 31 | s1 >>> 1,
    // NIST SP 800-38D §6.3 applies `V >> 1` and XORs R on carry. In this
    // 4x32-bit split, R = 0xe1 || 0^120 lives in the top byte of s0.
    s0: s0 >>> 1 ^ POLY << 24 & -(hiBit & 1)
    // reduce % poly
  };
};
var swapLE = (n) => (n >>> 0 & 255) << 24 | (n >>> 8 & 255) << 16 | (n >>> 16 & 255) << 8 | n >>> 24 & 255 | 0;
var estimateWindow = (bytes) => {
  if (bytes > 64 * 1024)
    return 8;
  if (bytes > 1024)
    return 4;
  return 2;
};
var GHASH = class {
  blockLen = BLOCK_SIZE;
  outputLen = BLOCK_SIZE;
  s0 = 0;
  s1 = 0;
  s2 = 0;
  s3 = 0;
  finished = false;
  destroyed = false;
  t;
  W;
  windowSize;
  // We select bits per window adaptively based on expectedLength
  constructor(key, expectedLength) {
    abytes2(key, 16, "key");
    key = copyBytes(key);
    const kView = createView2(key);
    let k0 = kView.getUint32(0, false);
    let k1 = kView.getUint32(4, false);
    let k2 = kView.getUint32(8, false);
    let k3 = kView.getUint32(12, false);
    const doubles = [];
    for (let i = 0; i < 128; i++) {
      doubles.push({ s0: swapLE(k0), s1: swapLE(k1), s2: swapLE(k2), s3: swapLE(k3) });
      ({ s0: k0, s1: k1, s2: k2, s3: k3 } = mul2(k0, k1, k2, k3));
    }
    const W = estimateWindow(expectedLength || 1024);
    if (![1, 2, 4, 8].includes(W))
      throw new Error("ghash: invalid window size, expected 2, 4 or 8");
    this.W = W;
    const bits = 128;
    const windows = bits / W;
    const windowSize = this.windowSize = 2 ** W;
    const items = [];
    for (let w = 0; w < windows; w++) {
      for (let byte = 0; byte < windowSize; byte++) {
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
        for (let j = 0; j < W; j++) {
          const bit = byte >>> W - j - 1 & 1;
          if (!bit)
            continue;
          const { s0: d0, s1: d1, s2: d2, s3: d3 } = doubles[W * w + j];
          s0 ^= d0, s1 ^= d1, s2 ^= d2, s3 ^= d3;
        }
        items.push({ s0, s1, s2, s3 });
      }
    }
    this.t = items;
  }
  _updateBlock(s0, s1, s2, s3) {
    s0 ^= this.s0, s1 ^= this.s1, s2 ^= this.s2, s3 ^= this.s3;
    const { W, t, windowSize } = this;
    let o0 = 0, o1 = 0, o2 = 0, o3 = 0;
    const mask = (1 << W) - 1;
    let w = 0;
    for (const num of [s0, s1, s2, s3]) {
      for (let bytePos = 0; bytePos < 4; bytePos++) {
        const byte = num >>> 8 * bytePos & 255;
        for (let bitPos = 8 / W - 1; bitPos >= 0; bitPos--) {
          const bit = byte >>> W * bitPos & mask;
          const { s0: e0, s1: e1, s2: e2, s3: e3 } = t[w * windowSize + bit];
          o0 ^= e0, o1 ^= e1, o2 ^= e2, o3 ^= e3;
          w += 1;
        }
      }
    }
    this.s0 = o0;
    this.s1 = o1;
    this.s2 = o2;
    this.s3 = o3;
  }
  update(data) {
    aexists2(this);
    abytes2(data);
    data = copyBytes(data);
    const b32 = u32(data);
    const blocks = Math.floor(data.length / BLOCK_SIZE);
    const left = data.length % BLOCK_SIZE;
    for (let i = 0; i < blocks; i++) {
      this._updateBlock(swap8IfBE(b32[i * 4 + 0]), swap8IfBE(b32[i * 4 + 1]), swap8IfBE(b32[i * 4 + 2]), swap8IfBE(b32[i * 4 + 3]));
    }
    if (left) {
      ZEROS16.set(data.subarray(blocks * BLOCK_SIZE));
      this._updateBlock(swap8IfBE(ZEROS32[0]), swap8IfBE(ZEROS32[1]), swap8IfBE(ZEROS32[2]), swap8IfBE(ZEROS32[3]));
      clean2(ZEROS32);
    }
    return this;
  }
  destroy() {
    this.destroyed = true;
    const { t } = this;
    for (const elm of t) {
      elm.s0 = 0, elm.s1 = 0, elm.s2 = 0, elm.s3 = 0;
    }
  }
  digestInto(out) {
    aexists2(this);
    aoutput32(out, this);
    this.finished = true;
    const { s0, s1, s2, s3 } = this;
    const o32 = u32(out);
    o32[0] = s0;
    o32[1] = s1;
    o32[2] = s2;
    o32[3] = s3;
    if (!isLE)
      swap32IfBE(o32.subarray(0, BLOCK_SIZE / 4));
  }
  digest() {
    const res = new Uint8Array(BLOCK_SIZE);
    this.digestInto(res);
    this.destroy();
    return res;
  }
};
var ghash = /* @__PURE__ */ wrapMacConstructor(16, (key, expectedLength) => new GHASH(key, expectedLength), (msg) => [msg.length]);

// node_modules/@noble/ciphers/aes.js
var BLOCK_SIZE2 = 16;
var BLOCK_SIZE32 = 4;
var EMPTY_BLOCK = /* @__PURE__ */ new Uint8Array(BLOCK_SIZE2);
var POLY2 = 283;
function validateKeyLength(key) {
  if (![16, 24, 32].includes(key.length))
    throw new Error('"aes key" expected Uint8Array of length 16/24/32, got length=' + key.length);
}
function mul22(n) {
  return n << 1 ^ POLY2 & -(n >> 7);
}
function mul(a, b) {
  let res = 0;
  for (; b > 0; b >>= 1) {
    res ^= a & -(b & 1);
    a = mul22(a);
  }
  return res;
}
var sbox = /* @__PURE__ */ (() => {
  const t = new Uint8Array(256);
  for (let i = 0, x = 1; i < 256; i++, x ^= mul22(x))
    t[i] = x;
  const box = new Uint8Array(256);
  box[0] = 99;
  for (let i = 0; i < 255; i++) {
    let x = t[255 - i];
    x |= x << 8;
    box[t[i]] = (x ^ x >> 4 ^ x >> 5 ^ x >> 6 ^ x >> 7 ^ 99) & 255;
  }
  clean2(t);
  return box;
})();
var invSbox = /* @__PURE__ */ sbox.map((_, j) => sbox.indexOf(j));
var rotr32_8 = (n) => n << 24 | n >>> 8;
var rotl32_8 = (n) => n << 8 | n >>> 24;
function genTtable(sbox2, fn) {
  if (sbox2.length !== 256)
    throw new Error("wrong sbox length");
  const T0 = new Uint32Array(256).map((_, j) => fn(sbox2[j]));
  const T1 = T0.map(rotl32_8);
  const T2 = T1.map(rotl32_8);
  const T3 = T2.map(rotl32_8);
  const T01 = new Uint32Array(256 * 256);
  const T23 = new Uint32Array(256 * 256);
  const sbox22 = new Uint16Array(256 * 256);
  for (let i = 0; i < 256; i++) {
    for (let j = 0; j < 256; j++) {
      const idx = i * 256 + j;
      T01[idx] = T0[i] ^ T1[j];
      T23[idx] = T2[i] ^ T3[j];
      sbox22[idx] = sbox2[i] << 8 | sbox2[j];
    }
  }
  return { sbox: sbox2, sbox2: sbox22, T0, T1, T2, T3, T01, T23 };
}
var tableEncoding = /* @__PURE__ */ genTtable(sbox, (s) => mul(s, 3) << 24 | s << 16 | s << 8 | mul(s, 2));
var tableDecoding = /* @__PURE__ */ genTtable(invSbox, (s) => mul(s, 11) << 24 | mul(s, 13) << 16 | mul(s, 9) << 8 | mul(s, 14));
var xPowers = /* @__PURE__ */ (() => {
  const p = new Uint8Array(16);
  for (let i = 0, x = 1; i < 16; i++, x = mul22(x))
    p[i] = x;
  return p;
})();
function expandKeyLE(key) {
  abytes2(key);
  const len = key.length;
  validateKeyLength(key);
  const { sbox2 } = tableEncoding;
  const toClean = [];
  if (!isLE || !isAligned32(key))
    toClean.push(key = copyBytes(key));
  const k32 = swap32IfBE(u32(key));
  const Nk = k32.length;
  const subByte = (n) => applySbox(sbox2, n, n, n, n);
  const xk = new Uint32Array(len + 28);
  xk.set(k32);
  for (let i = Nk; i < xk.length; i++) {
    let t = xk[i - 1];
    if (i % Nk === 0)
      t = subByte(rotr32_8(t)) ^ xPowers[i / Nk - 1];
    else if (Nk > 6 && i % Nk === 4)
      t = subByte(t);
    xk[i] = xk[i - Nk] ^ t;
  }
  clean2(...toClean);
  return xk;
}
function expandKeyDecLE(key) {
  const encKey = expandKeyLE(key);
  const xk = encKey.slice();
  const Nk = encKey.length;
  const { sbox2 } = tableEncoding;
  const { T0, T1, T2, T3 } = tableDecoding;
  for (let i = 0; i < Nk; i += 4) {
    for (let j = 0; j < 4; j++)
      xk[i + j] = encKey[Nk - i - 4 + j];
  }
  clean2(encKey);
  for (let i = 4; i < Nk - 4; i++) {
    const x = xk[i];
    const w = applySbox(sbox2, x, x, x, x);
    xk[i] = T0[w & 255] ^ T1[w >>> 8 & 255] ^ T2[w >>> 16 & 255] ^ T3[w >>> 24];
  }
  return xk;
}
function apply0123(T01, T23, s0, s1, s2, s3) {
  return T01[s0 << 8 & 65280 | s1 >>> 8 & 255] ^ T23[s2 >>> 8 & 65280 | s3 >>> 24 & 255];
}
function applySbox(sbox2, s0, s1, s2, s3) {
  return sbox2[s0 & 255 | s1 & 65280] | sbox2[s2 >>> 16 & 255 | s3 >>> 16 & 65280] << 16;
}
function encrypt(xk, s0, s1, s2, s3) {
  const { sbox2, T01, T23 } = tableEncoding;
  let k = 0;
  s0 ^= xk[k++], s1 ^= xk[k++], s2 ^= xk[k++], s3 ^= xk[k++];
  const rounds = xk.length / 4 - 2;
  for (let i = 0; i < rounds; i++) {
    const t02 = xk[k++] ^ apply0123(T01, T23, s0, s1, s2, s3);
    const t12 = xk[k++] ^ apply0123(T01, T23, s1, s2, s3, s0);
    const t22 = xk[k++] ^ apply0123(T01, T23, s2, s3, s0, s1);
    const t32 = xk[k++] ^ apply0123(T01, T23, s3, s0, s1, s2);
    s0 = t02, s1 = t12, s2 = t22, s3 = t32;
  }
  const t0 = xk[k++] ^ applySbox(sbox2, s0, s1, s2, s3);
  const t1 = xk[k++] ^ applySbox(sbox2, s1, s2, s3, s0);
  const t2 = xk[k++] ^ applySbox(sbox2, s2, s3, s0, s1);
  const t3 = xk[k++] ^ applySbox(sbox2, s3, s0, s1, s2);
  return { s0: t0, s1: t1, s2: t2, s3: t3 };
}
function decrypt(xk, s0, s1, s2, s3) {
  const { sbox2, T01, T23 } = tableDecoding;
  let k = 0;
  s0 ^= xk[k++], s1 ^= xk[k++], s2 ^= xk[k++], s3 ^= xk[k++];
  const rounds = xk.length / 4 - 2;
  for (let i = 0; i < rounds; i++) {
    const t02 = xk[k++] ^ apply0123(T01, T23, s0, s3, s2, s1);
    const t12 = xk[k++] ^ apply0123(T01, T23, s1, s0, s3, s2);
    const t22 = xk[k++] ^ apply0123(T01, T23, s2, s1, s0, s3);
    const t32 = xk[k++] ^ apply0123(T01, T23, s3, s2, s1, s0);
    s0 = t02, s1 = t12, s2 = t22, s3 = t32;
  }
  const t0 = xk[k++] ^ applySbox(sbox2, s0, s3, s2, s1);
  const t1 = xk[k++] ^ applySbox(sbox2, s1, s0, s3, s2);
  const t2 = xk[k++] ^ applySbox(sbox2, s2, s1, s0, s3);
  const t3 = xk[k++] ^ applySbox(sbox2, s3, s2, s1, s0);
  return { s0: t0, s1: t1, s2: t2, s3: t3 };
}
function ctr32(xk, isLE2, nonce, src, dst) {
  abytes2(nonce, BLOCK_SIZE2, "nonce");
  abytes2(src);
  dst = getOutput(src.length, dst);
  const ctr = nonce;
  const c32 = u32(ctr);
  const view = createView2(ctr);
  const src32 = u32(src);
  const dst32 = u32(dst);
  const ctrPos = isLE2 ? 0 : 12;
  const srcLen = src.length;
  let ctrNum = view.getUint32(ctrPos, isLE2);
  for (let i = 0; i + 4 <= src32.length; i += 4) {
    const { s0, s1, s2, s3 } = encrypt(xk, swap8IfBE(c32[0]), swap8IfBE(c32[1]), swap8IfBE(c32[2]), swap8IfBE(c32[3]));
    dst32[i + 0] = src32[i + 0] ^ swap8IfBE(s0);
    dst32[i + 1] = src32[i + 1] ^ swap8IfBE(s1);
    dst32[i + 2] = src32[i + 2] ^ swap8IfBE(s2);
    dst32[i + 3] = src32[i + 3] ^ swap8IfBE(s3);
    ctrNum = ctrNum + 1 >>> 0;
    view.setUint32(ctrPos, ctrNum, isLE2);
  }
  const start = BLOCK_SIZE2 * Math.floor(src32.length / BLOCK_SIZE32);
  if (start < srcLen) {
    const { s0, s1, s2, s3 } = encrypt(xk, swap8IfBE(c32[0]), swap8IfBE(c32[1]), swap8IfBE(c32[2]), swap8IfBE(c32[3]));
    const b32 = new Uint32Array([s0, s1, s2, s3]);
    swap32IfBE(b32);
    const buf = u8(b32);
    for (let i = start, pos = 0; i < srcLen; i++, pos++)
      dst[i] = src[i] ^ buf[pos];
    clean2(b32);
  }
  return dst;
}
function validateBlockDecrypt(data, dst) {
  abytes2(data);
  if (data.length % BLOCK_SIZE2 !== 0) {
    throw new Error("ciphertext must be multiple of " + BLOCK_SIZE2);
  }
  if (dst !== void 0) {
    getOutput(data.length, dst);
    complexOverlapBytes(data, dst);
  }
}
function validateBlockEncrypt(plaintext, pkcs5, dst) {
  abytes2(plaintext);
  let outLen = plaintext.length;
  const remaining = outLen % BLOCK_SIZE2;
  if (!pkcs5 && remaining !== 0)
    throw new Error("plaintext must be multiple of " + BLOCK_SIZE2);
  if (pkcs5) {
    let left = BLOCK_SIZE2 - remaining;
    if (!left)
      left = BLOCK_SIZE2;
    outLen = outLen + left;
  }
  if (dst !== void 0) {
    getOutput(outLen, dst);
    complexOverlapBytes(plaintext, dst);
  }
  return outLen;
}
function prepareBlockEncrypt(plaintext, outLen, dst) {
  if (dst === void 0)
    dst = new Uint8Array(outLen);
  if (!isLE || !isAligned32(plaintext))
    plaintext = copyBytes(plaintext);
  const o = u32(dst);
  return { b: plaintext, o, out: dst };
}
function validatePKCS(data, pkcs5) {
  if (!pkcs5)
    return data;
  const len = data.length;
  if (len === 0)
    throw new Error("pkcs7: empty ciphertext not allowed");
  const lastByte = data[len - 1];
  let valid = 1;
  valid &= lastByte - 1 >>> 31 ^ 1;
  valid &= 16 - lastByte >>> 31 ^ 1;
  for (let i = 0; i < 16; i++) {
    const shouldCheck = i - lastByte >>> 31;
    const eq = (data[len - 1 - i] ^ lastByte) === 0 ? 1 : 0;
    valid &= eq | shouldCheck ^ 1;
  }
  if (!valid)
    throw new Error("aes: bad decrypt");
  return data.subarray(0, len - lastByte);
}
function padPCKS(left) {
  const tmp = new Uint8Array(16);
  const tmp32 = u32(tmp);
  tmp.set(left);
  const paddingByte = BLOCK_SIZE2 - left.length;
  for (let i = BLOCK_SIZE2 - paddingByte; i < BLOCK_SIZE2; i++)
    tmp[i] = paddingByte;
  return tmp32;
}
var ecb = /* @__PURE__ */ wrapCipher({ blockSize: 16 }, function aesecb(key, opts = {}) {
  const pkcs5 = !opts.disablePadding;
  return {
    encrypt(plaintext, dst) {
      const outLen = validateBlockEncrypt(plaintext, pkcs5, dst);
      const xk = expandKeyLE(key);
      const { b: input, o, out: _out } = prepareBlockEncrypt(plaintext, outLen, dst);
      const b = u32(input);
      swap32IfBE(b);
      let i = 0;
      for (; i + 4 <= b.length; ) {
        const { s0, s1, s2, s3 } = encrypt(xk, b[i + 0], b[i + 1], b[i + 2], b[i + 3]);
        o[i++] = s0, o[i++] = s1, o[i++] = s2, o[i++] = s3;
      }
      if (pkcs5) {
        const tmp32 = padPCKS(plaintext.subarray(i * 4));
        swap32IfBE(tmp32);
        const { s0, s1, s2, s3 } = encrypt(xk, tmp32[0], tmp32[1], tmp32[2], tmp32[3]);
        o[i++] = s0, o[i++] = s1, o[i++] = s2, o[i++] = s3;
        clean2(tmp32);
      }
      swap32IfBE(o);
      clean2(xk);
      if (input !== plaintext)
        clean2(input);
      return _out;
    },
    decrypt(ciphertext, dst) {
      validateBlockDecrypt(ciphertext, dst);
      const xk = expandKeyDecLE(key);
      if (dst === void 0)
        dst = new Uint8Array(ciphertext.length);
      const toClean = [xk];
      if (!isLE || !isAligned32(ciphertext))
        toClean.push(ciphertext = copyBytes(ciphertext));
      const b = u32(ciphertext);
      const o = u32(dst);
      swap32IfBE(b);
      for (let i = 0; i + 4 <= b.length; ) {
        const { s0, s1, s2, s3 } = decrypt(xk, b[i + 0], b[i + 1], b[i + 2], b[i + 3]);
        o[i++] = s0, o[i++] = s1, o[i++] = s2, o[i++] = s3;
      }
      swap32IfBE(o);
      clean2(...toClean);
      return validatePKCS(dst, pkcs5);
    }
  };
});
function computeTag(fn, isLE2, key, data, AAD) {
  const aadLength = AAD ? AAD.length : 0;
  const h = fn.create(key, data.length + aadLength);
  if (AAD)
    h.update(AAD);
  const num = u64Lengths(8 * data.length, 8 * aadLength, isLE2);
  h.update(data);
  h.update(num);
  const res = h.digest();
  clean2(num);
  return res;
}
var gcm = /* @__PURE__ */ wrapCipher({ blockSize: 16, nonceLength: 12, tagLength: 16, withAAD: true, varSizeNonce: true }, function aesgcm(key, nonce, AAD) {
  if (nonce.length < 8)
    throw new Error("aes/gcm: invalid nonce length");
  const tagLength = 16;
  function _computeTag(authKey, tagMask, data) {
    const tag = computeTag(ghash, false, authKey, data, AAD);
    for (let i = 0; i < tagMask.length; i++)
      tag[i] ^= tagMask[i];
    return tag;
  }
  function deriveKeys2() {
    const xk = expandKeyLE(key);
    const authKey = EMPTY_BLOCK.slice();
    const counter = EMPTY_BLOCK.slice();
    ctr32(xk, false, counter, counter, authKey);
    if (nonce.length === 12) {
      counter.set(nonce);
    } else {
      const nonceLen = EMPTY_BLOCK.slice();
      const view = createView2(nonceLen);
      view.setBigUint64(8, BigInt(nonce.length * 8), false);
      const g = ghash.create(authKey).update(nonce).update(nonceLen);
      g.digestInto(counter);
      g.destroy();
    }
    const tagMask = ctr32(xk, false, counter, EMPTY_BLOCK);
    return { xk, authKey, counter, tagMask };
  }
  return {
    encrypt(plaintext) {
      const { xk, authKey, counter, tagMask } = deriveKeys2();
      const out = new Uint8Array(plaintext.length + tagLength);
      const toClean = [xk, authKey, counter, tagMask];
      if (!isAligned32(plaintext))
        toClean.push(plaintext = copyBytes(plaintext));
      ctr32(xk, false, counter, plaintext, out.subarray(0, plaintext.length));
      const tag = _computeTag(authKey, tagMask, out.subarray(0, out.length - tagLength));
      toClean.push(tag);
      out.set(tag, plaintext.length);
      clean2(...toClean);
      return out;
    },
    decrypt(ciphertext) {
      const { xk, authKey, counter, tagMask } = deriveKeys2();
      const toClean = [xk, authKey, tagMask, counter];
      if (!isAligned32(ciphertext))
        toClean.push(ciphertext = copyBytes(ciphertext));
      const data = ciphertext.subarray(0, -tagLength);
      const passedTag = ciphertext.subarray(-tagLength);
      const tag = _computeTag(authKey, tagMask, data);
      toClean.push(tag);
      if (!equalBytes(tag, passedTag)) {
        clean2(...toClean);
        throw new Error("aes-gcm: invalid tag");
      }
      const out = ctr32(xk, false, counter, data);
      clean2(...toClean);
      return out;
    }
  };
});

// node_modules/@noble/ciphers/_arx.js
var encodeStr = (str) => Uint8Array.from(str.split(""), (c) => c.charCodeAt(0));
var sigma16_32 = /* @__PURE__ */ (() => swap32IfBE(u32(encodeStr("expand 16-byte k"))))();
var sigma32_32 = /* @__PURE__ */ (() => swap32IfBE(u32(encodeStr("expand 32-byte k"))))();
function rotl2(a, b) {
  return a << b | a >>> 32 - b;
}
var BLOCK_LEN = 64;
var BLOCK_LEN32 = 16;
var MAX_COUNTER = /* @__PURE__ */ (() => 2 ** 32 - 1)();
var U32_EMPTY = /* @__PURE__ */ Uint32Array.of();
function runCipher(core, sigma, key, nonce, data, output, counter, rounds) {
  const len = data.length;
  const block = new Uint8Array(BLOCK_LEN);
  const b32 = u32(block);
  const isAligned = isLE && isAligned32(data) && isAligned32(output);
  const d32 = isAligned ? u32(data) : U32_EMPTY;
  const o32 = isAligned ? u32(output) : U32_EMPTY;
  if (!isLE) {
    for (let pos = 0; pos < len; counter++) {
      core(sigma, key, nonce, b32, counter, rounds);
      swap32IfBE(b32);
      if (counter >= MAX_COUNTER)
        throw new Error("arx: counter overflow");
      const take = Math.min(BLOCK_LEN, len - pos);
      for (let j = 0, posj; j < take; j++) {
        posj = pos + j;
        output[posj] = data[posj] ^ block[j];
      }
      pos += take;
    }
    return;
  }
  for (let pos = 0; pos < len; counter++) {
    core(sigma, key, nonce, b32, counter, rounds);
    if (counter >= MAX_COUNTER)
      throw new Error("arx: counter overflow");
    const take = Math.min(BLOCK_LEN, len - pos);
    if (isAligned && take === BLOCK_LEN) {
      const pos32 = pos / 4;
      if (pos % 4 !== 0)
        throw new Error("arx: invalid block position");
      for (let j = 0, posj; j < BLOCK_LEN32; j++) {
        posj = pos32 + j;
        o32[posj] = d32[posj] ^ b32[j];
      }
      pos += BLOCK_LEN;
      continue;
    }
    for (let j = 0, posj; j < take; j++) {
      posj = pos + j;
      output[posj] = data[posj] ^ block[j];
    }
    pos += take;
  }
}
function createCipher(core, opts) {
  const { allowShortKeys, extendNonceFn, counterLength, counterRight, rounds } = checkOpts2({ allowShortKeys: false, counterLength: 8, counterRight: false, rounds: 20 }, opts);
  if (typeof core !== "function")
    throw new Error("core must be a function");
  anumber2(counterLength);
  anumber2(rounds);
  abool(counterRight);
  abool(allowShortKeys);
  return (key, nonce, data, output, counter = 0) => {
    abytes2(key, void 0, "key");
    abytes2(nonce, void 0, "nonce");
    abytes2(data, void 0, "data");
    const len = data.length;
    output = getOutput(len, output, false);
    anumber2(counter);
    if (counter < 0 || counter >= MAX_COUNTER)
      throw new Error("arx: counter overflow");
    const toClean = [];
    let l = key.length;
    let k;
    let sigma;
    if (l === 32) {
      toClean.push(k = copyBytes(key));
      sigma = sigma32_32;
    } else if (l === 16 && allowShortKeys) {
      k = new Uint8Array(32);
      k.set(key);
      k.set(key, 16);
      sigma = sigma16_32;
      toClean.push(k);
    } else {
      abytes2(key, 32, "arx key");
      throw new Error("invalid key size");
    }
    if (!isLE || !isAligned32(nonce))
      toClean.push(nonce = copyBytes(nonce));
    let k32 = u32(k);
    if (extendNonceFn) {
      if (nonce.length !== 24)
        throw new Error("arx: extended nonce must be 24 bytes");
      const n16 = nonce.subarray(0, 16);
      if (isLE)
        extendNonceFn(sigma, k32, u32(n16), k32);
      else {
        const sigmaRaw = swap32IfBE(Uint32Array.from(sigma));
        extendNonceFn(sigmaRaw, k32, u32(n16), k32);
        clean2(sigmaRaw);
        swap32IfBE(k32);
      }
      nonce = nonce.subarray(16);
    } else if (!isLE)
      swap32IfBE(k32);
    const nonceNcLen = 16 - counterLength;
    if (nonceNcLen !== nonce.length)
      throw new Error(`arx: nonce must be ${nonceNcLen} or 16 bytes`);
    if (nonceNcLen !== 12) {
      const nc = new Uint8Array(12);
      nc.set(nonce, counterRight ? 0 : 12 - nonce.length);
      nonce = nc;
      toClean.push(nonce);
    }
    const n32 = swap32IfBE(u32(nonce));
    try {
      runCipher(core, sigma, k32, n32, data, output, counter, rounds);
      return output;
    } finally {
      clean2(...toClean);
    }
  };
}

// node_modules/@noble/ciphers/_poly1305.js
function u8to16(a, i) {
  return a[i++] & 255 | (a[i++] & 255) << 8;
}
var Poly1305 = class {
  blockLen = 16;
  outputLen = 16;
  buffer = new Uint8Array(16);
  r = new Uint16Array(10);
  // Allocating 1 array with .subarray() here is slower than 3
  h = new Uint16Array(10);
  pad = new Uint16Array(8);
  pos = 0;
  finished = false;
  destroyed = false;
  // Can be speed-up using BigUint64Array, at the cost of complexity
  constructor(key) {
    key = copyBytes(abytes2(key, 32, "key"));
    const t0 = u8to16(key, 0);
    const t1 = u8to16(key, 2);
    const t2 = u8to16(key, 4);
    const t3 = u8to16(key, 6);
    const t4 = u8to16(key, 8);
    const t5 = u8to16(key, 10);
    const t6 = u8to16(key, 12);
    const t7 = u8to16(key, 14);
    this.r[0] = t0 & 8191;
    this.r[1] = (t0 >>> 13 | t1 << 3) & 8191;
    this.r[2] = (t1 >>> 10 | t2 << 6) & 7939;
    this.r[3] = (t2 >>> 7 | t3 << 9) & 8191;
    this.r[4] = (t3 >>> 4 | t4 << 12) & 255;
    this.r[5] = t4 >>> 1 & 8190;
    this.r[6] = (t4 >>> 14 | t5 << 2) & 8191;
    this.r[7] = (t5 >>> 11 | t6 << 5) & 8065;
    this.r[8] = (t6 >>> 8 | t7 << 8) & 8191;
    this.r[9] = t7 >>> 5 & 127;
    for (let i = 0; i < 8; i++)
      this.pad[i] = u8to16(key, 16 + 2 * i);
  }
  process(data, offset, isLast = false) {
    const hibit = isLast ? 0 : 1 << 11;
    const { h, r } = this;
    const r0 = r[0];
    const r1 = r[1];
    const r2 = r[2];
    const r3 = r[3];
    const r4 = r[4];
    const r5 = r[5];
    const r6 = r[6];
    const r7 = r[7];
    const r8 = r[8];
    const r9 = r[9];
    const t0 = u8to16(data, offset + 0);
    const t1 = u8to16(data, offset + 2);
    const t2 = u8to16(data, offset + 4);
    const t3 = u8to16(data, offset + 6);
    const t4 = u8to16(data, offset + 8);
    const t5 = u8to16(data, offset + 10);
    const t6 = u8to16(data, offset + 12);
    const t7 = u8to16(data, offset + 14);
    let h0 = h[0] + (t0 & 8191);
    let h1 = h[1] + ((t0 >>> 13 | t1 << 3) & 8191);
    let h2 = h[2] + ((t1 >>> 10 | t2 << 6) & 8191);
    let h3 = h[3] + ((t2 >>> 7 | t3 << 9) & 8191);
    let h4 = h[4] + ((t3 >>> 4 | t4 << 12) & 8191);
    let h5 = h[5] + (t4 >>> 1 & 8191);
    let h6 = h[6] + ((t4 >>> 14 | t5 << 2) & 8191);
    let h7 = h[7] + ((t5 >>> 11 | t6 << 5) & 8191);
    let h8 = h[8] + ((t6 >>> 8 | t7 << 8) & 8191);
    let h9 = h[9] + (t7 >>> 5 | hibit);
    let c = 0;
    let d0 = c + h0 * r0 + h1 * (5 * r9) + h2 * (5 * r8) + h3 * (5 * r7) + h4 * (5 * r6);
    c = d0 >>> 13;
    d0 &= 8191;
    d0 += h5 * (5 * r5) + h6 * (5 * r4) + h7 * (5 * r3) + h8 * (5 * r2) + h9 * (5 * r1);
    c += d0 >>> 13;
    d0 &= 8191;
    let d1 = c + h0 * r1 + h1 * r0 + h2 * (5 * r9) + h3 * (5 * r8) + h4 * (5 * r7);
    c = d1 >>> 13;
    d1 &= 8191;
    d1 += h5 * (5 * r6) + h6 * (5 * r5) + h7 * (5 * r4) + h8 * (5 * r3) + h9 * (5 * r2);
    c += d1 >>> 13;
    d1 &= 8191;
    let d2 = c + h0 * r2 + h1 * r1 + h2 * r0 + h3 * (5 * r9) + h4 * (5 * r8);
    c = d2 >>> 13;
    d2 &= 8191;
    d2 += h5 * (5 * r7) + h6 * (5 * r6) + h7 * (5 * r5) + h8 * (5 * r4) + h9 * (5 * r3);
    c += d2 >>> 13;
    d2 &= 8191;
    let d3 = c + h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * (5 * r9);
    c = d3 >>> 13;
    d3 &= 8191;
    d3 += h5 * (5 * r8) + h6 * (5 * r7) + h7 * (5 * r6) + h8 * (5 * r5) + h9 * (5 * r4);
    c += d3 >>> 13;
    d3 &= 8191;
    let d4 = c + h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0;
    c = d4 >>> 13;
    d4 &= 8191;
    d4 += h5 * (5 * r9) + h6 * (5 * r8) + h7 * (5 * r7) + h8 * (5 * r6) + h9 * (5 * r5);
    c += d4 >>> 13;
    d4 &= 8191;
    let d5 = c + h0 * r5 + h1 * r4 + h2 * r3 + h3 * r2 + h4 * r1;
    c = d5 >>> 13;
    d5 &= 8191;
    d5 += h5 * r0 + h6 * (5 * r9) + h7 * (5 * r8) + h8 * (5 * r7) + h9 * (5 * r6);
    c += d5 >>> 13;
    d5 &= 8191;
    let d6 = c + h0 * r6 + h1 * r5 + h2 * r4 + h3 * r3 + h4 * r2;
    c = d6 >>> 13;
    d6 &= 8191;
    d6 += h5 * r1 + h6 * r0 + h7 * (5 * r9) + h8 * (5 * r8) + h9 * (5 * r7);
    c += d6 >>> 13;
    d6 &= 8191;
    let d7 = c + h0 * r7 + h1 * r6 + h2 * r5 + h3 * r4 + h4 * r3;
    c = d7 >>> 13;
    d7 &= 8191;
    d7 += h5 * r2 + h6 * r1 + h7 * r0 + h8 * (5 * r9) + h9 * (5 * r8);
    c += d7 >>> 13;
    d7 &= 8191;
    let d8 = c + h0 * r8 + h1 * r7 + h2 * r6 + h3 * r5 + h4 * r4;
    c = d8 >>> 13;
    d8 &= 8191;
    d8 += h5 * r3 + h6 * r2 + h7 * r1 + h8 * r0 + h9 * (5 * r9);
    c += d8 >>> 13;
    d8 &= 8191;
    let d9 = c + h0 * r9 + h1 * r8 + h2 * r7 + h3 * r6 + h4 * r5;
    c = d9 >>> 13;
    d9 &= 8191;
    d9 += h5 * r4 + h6 * r3 + h7 * r2 + h8 * r1 + h9 * r0;
    c += d9 >>> 13;
    d9 &= 8191;
    c = (c << 2) + c | 0;
    c = c + d0 | 0;
    d0 = c & 8191;
    c = c >>> 13;
    d1 += c;
    h[0] = d0;
    h[1] = d1;
    h[2] = d2;
    h[3] = d3;
    h[4] = d4;
    h[5] = d5;
    h[6] = d6;
    h[7] = d7;
    h[8] = d8;
    h[9] = d9;
  }
  finalize() {
    const { h, pad } = this;
    const g = new Uint16Array(10);
    let c = h[1] >>> 13;
    h[1] &= 8191;
    for (let i = 2; i < 10; i++) {
      h[i] += c;
      c = h[i] >>> 13;
      h[i] &= 8191;
    }
    h[0] += c * 5;
    c = h[0] >>> 13;
    h[0] &= 8191;
    h[1] += c;
    c = h[1] >>> 13;
    h[1] &= 8191;
    h[2] += c;
    g[0] = h[0] + 5;
    c = g[0] >>> 13;
    g[0] &= 8191;
    for (let i = 1; i < 10; i++) {
      g[i] = h[i] + c;
      c = g[i] >>> 13;
      g[i] &= 8191;
    }
    g[9] -= 1 << 13;
    let mask = (c ^ 1) - 1;
    for (let i = 0; i < 10; i++)
      g[i] &= mask;
    mask = ~mask;
    for (let i = 0; i < 10; i++)
      h[i] = h[i] & mask | g[i];
    h[0] = (h[0] | h[1] << 13) & 65535;
    h[1] = (h[1] >>> 3 | h[2] << 10) & 65535;
    h[2] = (h[2] >>> 6 | h[3] << 7) & 65535;
    h[3] = (h[3] >>> 9 | h[4] << 4) & 65535;
    h[4] = (h[4] >>> 12 | h[5] << 1 | h[6] << 14) & 65535;
    h[5] = (h[6] >>> 2 | h[7] << 11) & 65535;
    h[6] = (h[7] >>> 5 | h[8] << 8) & 65535;
    h[7] = (h[8] >>> 8 | h[9] << 5) & 65535;
    let f = h[0] + pad[0];
    h[0] = f & 65535;
    for (let i = 1; i < 8; i++) {
      f = (h[i] + pad[i] | 0) + (f >>> 16) | 0;
      h[i] = f & 65535;
    }
    clean2(g);
  }
  update(data) {
    aexists2(this);
    abytes2(data);
    data = copyBytes(data);
    const { buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(data, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(buffer, 0, false);
        this.pos = 0;
      }
    }
    return this;
  }
  destroy() {
    this.destroyed = true;
    clean2(this.h, this.r, this.buffer, this.pad);
  }
  digestInto(out) {
    aexists2(this);
    aoutput2(out, this);
    this.finished = true;
    const { buffer, h } = this;
    let { pos } = this;
    if (pos) {
      buffer[pos++] = 1;
      for (; pos < 16; pos++)
        buffer[pos] = 0;
      this.process(buffer, 0, true);
    }
    this.finalize();
    let opos = 0;
    for (let i = 0; i < 8; i++) {
      out[opos++] = h[i] >>> 0;
      out[opos++] = h[i] >>> 8;
    }
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
};
var poly1305 = /* @__PURE__ */ wrapMacConstructor(32, (key) => new Poly1305(key));

// node_modules/@noble/ciphers/chacha.js
function chachaCore(s, k, n, out, cnt, rounds = 20) {
  let y00 = s[0], y01 = s[1], y02 = s[2], y03 = s[3], y04 = k[0], y05 = k[1], y06 = k[2], y07 = k[3], y08 = k[4], y09 = k[5], y10 = k[6], y11 = k[7], y12 = cnt, y13 = n[0], y14 = n[1], y15 = n[2];
  let x00 = y00, x01 = y01, x02 = y02, x03 = y03, x04 = y04, x05 = y05, x06 = y06, x07 = y07, x08 = y08, x09 = y09, x10 = y10, x11 = y11, x12 = y12, x13 = y13, x14 = y14, x15 = y15;
  for (let r = 0; r < rounds; r += 2) {
    x00 = x00 + x04 | 0;
    x12 = rotl2(x12 ^ x00, 16);
    x08 = x08 + x12 | 0;
    x04 = rotl2(x04 ^ x08, 12);
    x00 = x00 + x04 | 0;
    x12 = rotl2(x12 ^ x00, 8);
    x08 = x08 + x12 | 0;
    x04 = rotl2(x04 ^ x08, 7);
    x01 = x01 + x05 | 0;
    x13 = rotl2(x13 ^ x01, 16);
    x09 = x09 + x13 | 0;
    x05 = rotl2(x05 ^ x09, 12);
    x01 = x01 + x05 | 0;
    x13 = rotl2(x13 ^ x01, 8);
    x09 = x09 + x13 | 0;
    x05 = rotl2(x05 ^ x09, 7);
    x02 = x02 + x06 | 0;
    x14 = rotl2(x14 ^ x02, 16);
    x10 = x10 + x14 | 0;
    x06 = rotl2(x06 ^ x10, 12);
    x02 = x02 + x06 | 0;
    x14 = rotl2(x14 ^ x02, 8);
    x10 = x10 + x14 | 0;
    x06 = rotl2(x06 ^ x10, 7);
    x03 = x03 + x07 | 0;
    x15 = rotl2(x15 ^ x03, 16);
    x11 = x11 + x15 | 0;
    x07 = rotl2(x07 ^ x11, 12);
    x03 = x03 + x07 | 0;
    x15 = rotl2(x15 ^ x03, 8);
    x11 = x11 + x15 | 0;
    x07 = rotl2(x07 ^ x11, 7);
    x00 = x00 + x05 | 0;
    x15 = rotl2(x15 ^ x00, 16);
    x10 = x10 + x15 | 0;
    x05 = rotl2(x05 ^ x10, 12);
    x00 = x00 + x05 | 0;
    x15 = rotl2(x15 ^ x00, 8);
    x10 = x10 + x15 | 0;
    x05 = rotl2(x05 ^ x10, 7);
    x01 = x01 + x06 | 0;
    x12 = rotl2(x12 ^ x01, 16);
    x11 = x11 + x12 | 0;
    x06 = rotl2(x06 ^ x11, 12);
    x01 = x01 + x06 | 0;
    x12 = rotl2(x12 ^ x01, 8);
    x11 = x11 + x12 | 0;
    x06 = rotl2(x06 ^ x11, 7);
    x02 = x02 + x07 | 0;
    x13 = rotl2(x13 ^ x02, 16);
    x08 = x08 + x13 | 0;
    x07 = rotl2(x07 ^ x08, 12);
    x02 = x02 + x07 | 0;
    x13 = rotl2(x13 ^ x02, 8);
    x08 = x08 + x13 | 0;
    x07 = rotl2(x07 ^ x08, 7);
    x03 = x03 + x04 | 0;
    x14 = rotl2(x14 ^ x03, 16);
    x09 = x09 + x14 | 0;
    x04 = rotl2(x04 ^ x09, 12);
    x03 = x03 + x04 | 0;
    x14 = rotl2(x14 ^ x03, 8);
    x09 = x09 + x14 | 0;
    x04 = rotl2(x04 ^ x09, 7);
  }
  let oi = 0;
  out[oi++] = y00 + x00 | 0;
  out[oi++] = y01 + x01 | 0;
  out[oi++] = y02 + x02 | 0;
  out[oi++] = y03 + x03 | 0;
  out[oi++] = y04 + x04 | 0;
  out[oi++] = y05 + x05 | 0;
  out[oi++] = y06 + x06 | 0;
  out[oi++] = y07 + x07 | 0;
  out[oi++] = y08 + x08 | 0;
  out[oi++] = y09 + x09 | 0;
  out[oi++] = y10 + x10 | 0;
  out[oi++] = y11 + x11 | 0;
  out[oi++] = y12 + x12 | 0;
  out[oi++] = y13 + x13 | 0;
  out[oi++] = y14 + x14 | 0;
  out[oi++] = y15 + x15 | 0;
}
var chacha20 = /* @__PURE__ */ createCipher(chachaCore, {
  counterRight: false,
  counterLength: 4,
  allowShortKeys: false
});
var ZEROS162 = /* @__PURE__ */ new Uint8Array(16);
var updatePadded = (h, msg) => {
  h.update(msg);
  const leftover = msg.length % 16;
  if (leftover)
    h.update(ZEROS162.subarray(leftover));
};
var ZEROS322 = /* @__PURE__ */ new Uint8Array(32);
function computeTag2(fn, key, nonce, ciphertext, AAD) {
  if (AAD !== void 0)
    abytes2(AAD, void 0, "AAD");
  const authKey = fn(key, nonce, ZEROS322);
  const lengths = u64Lengths(ciphertext.length, AAD ? AAD.length : 0, true);
  const h = poly1305.create(authKey);
  if (AAD)
    updatePadded(h, AAD);
  updatePadded(h, ciphertext);
  h.update(lengths);
  const res = h.digest();
  clean2(authKey, lengths);
  return res;
}
var _poly1305_aead = (xorStream) => (key, nonce, AAD) => {
  const tagLength = 16;
  return {
    encrypt(plaintext, output) {
      const plength = plaintext.length;
      output = getOutput(plength + tagLength, output, false);
      output.set(plaintext);
      const oPlain = output.subarray(0, -tagLength);
      xorStream(key, nonce, oPlain, oPlain, 1);
      const tag = computeTag2(xorStream, key, nonce, oPlain, AAD);
      output.set(tag, plength);
      clean2(tag);
      return output;
    },
    decrypt(ciphertext, output) {
      output = getOutput(ciphertext.length - tagLength, output, false);
      const data = ciphertext.subarray(0, -tagLength);
      const passedTag = ciphertext.subarray(-tagLength);
      const tag = computeTag2(xorStream, key, nonce, data, AAD);
      if (!equalBytes(passedTag, tag)) {
        clean2(tag);
        throw new Error("invalid tag");
      }
      output.set(ciphertext.subarray(0, -tagLength));
      xorStream(key, nonce, output, output, 1);
      clean2(tag);
      return output;
    }
  };
};
var chacha20poly1305 = /* @__PURE__ */ wrapCipher(
  { blockSize: 64, nonceLength: 12, tagLength: 16, withAAD: true },
  /* @__PURE__ */ _poly1305_aead(chacha20)
);

// node_modules/@noble/curves/utils.js
function aarray(item, title, inner = () => {
}) {
  if (!Array.isArray(item))
    throw new TypeError(`"${title}" expected array, got type=${typeof item}`);
  for (let i = 0; i < item.length; i++)
    inner(item[i], `${title}[${i}]`);
  return item;
}
var abytes3 = (value, length2, title) => abytes(value, length2, title);
var anumber3 = anumber;
function astring(value, title = "") {
  if (typeof value !== "string") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected string, got type=" + typeof value);
  }
  return value;
}
function aobject3(value, title = "object") {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(title === "object" ? "expected valid options object" : `"${title}" expected object, got type=${typeof value}`);
  return value;
}
function afunction(value, title) {
  if (typeof value !== "function")
    throw new TypeError(`"${title}" is invalid: expected function, got ${typeof value}`);
  return value;
}
var bytesToHex2 = bytesToHex;
var concatBytes3 = (...arrays) => concatBytes(...arrays);
var hexToBytes2 = (hex) => hexToBytes(hex);
var isBytes3 = isBytes;
var randomBytes3 = (bytesLength) => randomBytes(bytesLength);
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
var atitle3 = (title) => title ? `"${title}" ` : "";
function abool2(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle3(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function abignumber(n) {
  if (typeof n === "bigint") {
    if (!isPosBig(n))
      throw new RangeError("positive bigint expected, got " + n);
  } else
    anumber3(n);
  return n;
}
function asafenumber(value, title = "") {
  if (typeof value !== "number") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected number, got type=" + typeof value);
  }
  if (!Number.isSafeInteger(value)) {
    const prefix = title && `"${title}" `;
    throw new RangeError(prefix + "expected safe integer, got " + value);
  }
}
function numberToHexUnpadded(num) {
  const hex = abignumber(num).toString(16);
  return hex.length & 1 ? "0" + hex : hex;
}
function hexToNumber(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  return hex === "" ? _0n : BigInt("0x" + hex);
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  return hexToNumber(bytesToHex(copyBytes2(abytes(bytes)).reverse()));
}
function numberToBytesBE(n, len) {
  anumber(len);
  if (len === 0)
    throw new Error("zero output length is invalid");
  n = abignumber(n);
  const expectedLen = len * 2;
  const hex = n.toString(16);
  if (hex.length > expectedLen)
    throw new RangeError("number is too large");
  return hexToBytes(hex.padStart(expectedLen, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function copyBytes2(bytes) {
  return Uint8Array.from(abytes3(bytes));
}
function isPosBig(n) {
  return typeof n === "bigint" && _0n <= n;
}
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function aInRange(title, n, min, max) {
  if (!inRange(n, min, max))
    throw new RangeError("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen(n) {
  if (n < _0n)
    throw new Error("expected non-negative bigint, got " + n);
  return n === _0n ? 0 : n.toString(2).length;
}
var bitMask = (n) => {
  asafenumber(n, "n");
  return (_1n << BigInt(n)) - _1n;
};
function createHmacDrbg(hashLen, qByteLen, hmacFn) {
  anumber(hashLen, "hashLen");
  anumber(qByteLen, "qByteLen");
  if (typeof hmacFn !== "function")
    throw new TypeError("hmacFn must be a function");
  const u8n = (len) => new Uint8Array(len);
  const NULL = Uint8Array.of();
  const byte0 = Uint8Array.of(0);
  const byte1 = Uint8Array.of(1);
  const _maxDrbgIters = 1e3;
  let v = u8n(hashLen);
  let k = u8n(hashLen);
  let i = 0;
  const reset = () => {
    v.fill(1);
    k.fill(0);
    i = 0;
  };
  const h = (...msgs) => hmacFn(k, concatBytes3(v, ...msgs));
  const reseed = (seed = NULL) => {
    k = h(byte0, seed);
    v = h();
    if (seed.length === 0)
      return;
    k = h(byte1, seed);
    v = h();
  };
  const gen = () => {
    if (i++ >= _maxDrbgIters)
      throw new Error("drbg: tried max amount of iterations");
    let len = 0;
    const out = [];
    while (len < qByteLen) {
      v = h();
      const sl = v.slice();
      out.push(sl);
      len += v.length;
    }
    return concatBytes3(...out);
  };
  const genUntil = (seed, pred) => {
    reset();
    reseed(seed);
    let res = void 0;
    while ((res = pred(gen())) === void 0)
      reseed();
    reset();
    return res;
  };
  return genUntil;
}
function validateObject(object, fields = {}, optFields = {}, title = "object") {
  aobject3(object, title);
  aobject3(fields, "fields");
  aobject3(optFields, "optFields");
  function checkField(fieldName, expectedType, isOpt) {
    const label = title === "object" ? `param "${String(fieldName)}"` : `"${title}.${String(fieldName)}"`;
    const val = object[fieldName];
    if (!Object.hasOwn(object, fieldName) && (isOpt ? val !== void 0 : expectedType !== "function")) {
      throw new TypeError(`${label} is invalid: expected own property`);
    }
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new TypeError(`${label} is invalid: expected ${expectedType}, got ${current}`);
  }
  const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
  iter(fields, false);
  iter(optFields, true);
}

// node_modules/@noble/curves/abstract/modular.js
var _0n2 = /* @__PURE__ */ BigInt(0);
var _1n2 = /* @__PURE__ */ BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _7n = /* @__PURE__ */ BigInt(7);
var _8n = /* @__PURE__ */ BigInt(8);
var _9n = /* @__PURE__ */ BigInt(9);
var _15n = /* @__PURE__ */ BigInt(15);
var _16n = /* @__PURE__ */ BigInt(16);
var POW_WINDOWED_MIN = /* @__PURE__ */ BigInt("0x10000000000000000");
function mod(a, b) {
  if (b <= _0n2)
    throw new Error("mod: expected positive modulus, got " + b);
  const result = a % b;
  return result >= _0n2 ? result : b + result;
}
function pow(num, power, modulo) {
  if (modulo <= _1n2)
    throw new Error("pow: expected modulus > 1, got " + modulo);
  if (typeof power !== "bigint")
    throw new TypeError("invalid exponent: expected bigint, got " + typeof power);
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return _1n2;
  if (power === _1n2)
    return num;
  let d = num % modulo;
  if (d < _0n2)
    d += modulo;
  if (power < POW_WINDOWED_MIN) {
    let p2 = _1n2;
    while (power > _0n2) {
      if (power & _1n2)
        p2 = p2 * d % modulo;
      d = d * d % modulo;
      power >>= _1n2;
    }
    return p2;
  }
  const digits = [];
  while (power > _0n2) {
    digits.push(Number(power & _15n));
    power >>= _4n;
  }
  const table = new Array(16);
  table[0] = _1n2;
  table[1] = d;
  for (let i = 2; i < 16; i++)
    table[i] = table[i - 1] * d % modulo;
  let p = table[digits[digits.length - 1]];
  for (let w = digits.length - 2; w >= 0; w--) {
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    const digit = digits[w];
    if (digit !== 0)
      p = p * table[digit] % modulo;
  }
  return p;
}
function pow2(x, power, modulo) {
  if (modulo <= _1n2)
    throw new Error("pow2: expected modulus > 1, got " + modulo);
  if (power < _0n2)
    throw new Error("pow2: expected non-negative exponent, got " + power);
  let res = x;
  while (power-- > _0n2) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert2(number, modulo) {
  if (number === _0n2)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _1n2)
    throw new Error("invert: expected modulus > 1, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n2, u = _1n2;
  while (a !== _0n2) {
    const q = b / a;
    const r = b - a * q;
    const m = x - u * q;
    b = a, a = r, x = u, u = m;
  }
  const gcd = b;
  if (gcd !== _1n2)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function invertCt(a, prime) {
  if (prime <= _1n2)
    throw new Error("invertCt: expected prime modulus > 1, got " + prime);
  const an = mod(a, prime);
  if (an === _0n2)
    throw new Error("invertCt: expected non-zero number");
  const inverse = pow(an, prime - _2n, prime);
  if (mod(an * inverse, prime) !== _1n2)
    throw new Error("invertCt: does not exist");
  return inverse;
}
function assertIsSquare(Fp, root, n) {
  const F = Fp;
  if (!F.eql(F.sqr(root), n))
    throw new Error("Cannot find square root");
}
function aoddModulus(order, fnName) {
  if ((order & _1n2) === _0n2)
    throw new Error(fnName + ": expected odd modulus, got " + order);
}
function sqrt3mod4(Fp, n) {
  const F = Fp;
  const p1div4 = (F.ORDER + _1n2) / _4n;
  const root = F.pow(n, p1div4);
  assertIsSquare(F, root, n);
  return root;
}
function sqrt5mod8(Fp, n) {
  const F = Fp;
  const p5div8 = (F.ORDER - _5n) / _8n;
  const n2 = F.mul(n, _2n);
  const v = F.pow(n2, p5div8);
  const nv = F.mul(n, v);
  const i = F.mul(F.mul(nv, _2n), v);
  const root = F.mul(nv, F.sub(i, F.ONE));
  assertIsSquare(F, root, n);
  return root;
}
function sqrt9mod16(P) {
  const Fp_ = Field(P);
  const tn = tonelliShanks(P);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P + _7n) / _16n;
  return ((Fp, n) => {
    const F = Fp;
    let tv1 = F.pow(n, c4);
    let tv2 = F.mul(tv1, c1);
    const tv3 = F.mul(tv1, c2);
    const tv4 = F.mul(tv1, c3);
    const e1 = F.eql(F.sqr(tv2), n);
    const e2 = F.eql(F.sqr(tv3), n);
    tv1 = F.cmov(tv1, tv2, e1);
    tv2 = F.cmov(tv4, tv3, e2);
    const e3 = F.eql(F.sqr(tv2), n);
    const root = F.cmov(tv1, tv2, e3);
    assertIsSquare(F, root, n);
    return root;
  });
}
function tonelliShanks(P) {
  if (P < _3n)
    throw new Error("sqrt is not defined for small field");
  aoddModulus(P, "tonelliShanks");
  let Q = P - _1n2;
  let S = 0;
  while (Q % _2n === _0n2) {
    Q /= _2n;
    S++;
  }
  let Z = _2n;
  const _Fp = Field(P);
  while (FpLegendre(_Fp, Z) === 1) {
    if (Z++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod4;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n2) / _2n;
  return function tonelliSlow(Fp, n) {
    const F = Fp;
    if (F.is0(n))
      return n;
    if (FpLegendre(F, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = F.mul(F.ONE, cc);
    let t = F.pow(n, Q);
    let R = F.pow(n, Q1div2);
    while (!F.eql(t, F.ONE)) {
      if (F.is0(t))
        throw new Error("Cannot find square root: probably non-prime P");
      let i = 1;
      let t_tmp = F.sqr(t);
      while (!F.eql(t_tmp, F.ONE)) {
        i++;
        t_tmp = F.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n2 << BigInt(M - i - 1);
      const b = F.pow(c, exponent);
      M = i;
      c = F.sqr(b);
      t = F.mul(t, c);
      R = F.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P) {
  aoddModulus(P, "Fp.sqrt");
  if (P % _4n === _3n)
    return sqrt3mod4;
  if (P % _8n === _5n)
    return sqrt5mod8;
  if (P % _16n === _9n)
    return sqrt9mod16(P);
  return tonelliShanks(P);
}
var isNegativeLE = (num, modulo) => (mod(num, modulo) & _1n2) === _1n2;
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  aobject3(field, "field");
  if (typeof field.ORDER !== "bigint")
    throw new TypeError('param "ORDER" is invalid: expected bigint, got ' + typeof field.ORDER);
  asafenumber(field.BYTES, "BYTES");
  asafenumber(field.BITS, "BITS");
  for (const name of FIELD_FIELDS)
    afunction(field[name], "field." + name);
  if (field.BYTES < 1 || field.BITS < 1)
    throw new Error("invalid field: expected BYTES/BITS > 0");
  if (field.ORDER <= _1n2)
    throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
  return field;
}
function FpInvertBatch(Fp, nums, passZero = false) {
  validateField(Fp);
  aarray(nums, "nums");
  abool2(passZero, "passZero");
  const F = Fp;
  const inverted = new Array(nums.length).fill(passZero ? F.ZERO : void 0);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = acc;
    return F.mul(acc, num);
  }, F.ONE);
  const invertedAcc = F.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = F.mul(acc, inverted[i]);
    return F.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre(Fp, n) {
  validateField(Fp);
  const F = Fp;
  aoddModulus(F.ORDER, "FpLegendre");
  const p1mod2 = (F.ORDER - _1n2) / _2n;
  const powered = F.pow(n, p1mod2);
  const yes = F.eql(powered, F.ONE);
  const zero = F.eql(powered, F.ZERO);
  const no = F.eql(powered, F.neg(F.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength(n, nBitLength) {
  if (nBitLength !== void 0)
    anumber3(nBitLength);
  if (n <= _0n2)
    throw new Error("invalid n length: expected positive n, got " + n);
  if (nBitLength !== void 0 && nBitLength < 1)
    throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
  const bits = bitLen(n);
  if (nBitLength !== void 0 && nBitLength < bits)
    throw new Error(`invalid n length: expected nBitLength (${nBitLength}) >= bitLen(n) (${bits})`);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : bits;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
var FIELD_SQRT = /* @__PURE__ */ new WeakMap();
var _Field = class {
  ORDER;
  BITS;
  BYTES;
  isLE;
  ZERO = _0n2;
  ONE = _1n2;
  _lengths;
  _mod;
  constructor(ORDER, opts = {}) {
    if (ORDER <= _1n2)
      throw new Error("invalid field: expected ORDER > 1, got " + ORDER);
    let _nbitLength = void 0;
    this.isLE = false;
    if (opts != null && typeof opts === "object") {
      if (typeof opts.BITS === "number")
        _nbitLength = opts.BITS;
      if (typeof opts.sqrt === "function")
        Object.defineProperty(this, "sqrt", { value: opts.sqrt, enumerable: true });
      if (typeof opts.isLE === "boolean")
        this.isLE = opts.isLE;
      if (opts.allowedLengths)
        this._lengths = Object.freeze(opts.allowedLengths.slice());
      if (typeof opts.modFromBytes === "boolean")
        this._mod = opts.modFromBytes;
    }
    const { nBitLength, nByteLength } = nLength(ORDER, _nbitLength);
    if (nByteLength > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    this.ORDER = ORDER;
    this.BITS = nBitLength;
    this.BYTES = nByteLength;
    Object.freeze(this);
  }
  create(num) {
    return mod(num, this.ORDER);
  }
  isValid(num) {
    if (typeof num !== "bigint")
      throw new TypeError("invalid field element: expected bigint, got " + typeof num);
    return _0n2 <= num && num < this.ORDER;
  }
  is0(num) {
    return num === _0n2;
  }
  // is valid and invertible
  isValidNot0(num) {
    return !this.is0(num) && this.isValid(num);
  }
  isOdd(num) {
    return (num & _1n2) === _1n2;
  }
  neg(num) {
    return mod(-num, this.ORDER);
  }
  eql(lhs, rhs) {
    return lhs === rhs;
  }
  sqr(num) {
    return mod(num * num, this.ORDER);
  }
  add(lhs, rhs) {
    return mod(lhs + rhs, this.ORDER);
  }
  sub(lhs, rhs) {
    return mod(lhs - rhs, this.ORDER);
  }
  mul(lhs, rhs) {
    return mod(lhs * rhs, this.ORDER);
  }
  pow(num, power) {
    return pow(num, power, this.ORDER);
  }
  div(lhs, rhs) {
    return mod(lhs * invert2(rhs, this.ORDER), this.ORDER);
  }
  // Same as above, but doesn't normalize
  sqrN(num) {
    return num * num;
  }
  addN(lhs, rhs) {
    return lhs + rhs;
  }
  subN(lhs, rhs) {
    return lhs - rhs;
  }
  mulN(lhs, rhs) {
    return lhs * rhs;
  }
  inv(num) {
    return invert2(num, this.ORDER);
  }
  sqrt(num) {
    let sqrt = FIELD_SQRT.get(this);
    if (!sqrt)
      FIELD_SQRT.set(this, sqrt = FpSqrt(this.ORDER));
    return sqrt(this, num);
  }
  toBytes(num) {
    return this.isLE ? numberToBytesLE(num, this.BYTES) : numberToBytesBE(num, this.BYTES);
  }
  fromBytes(bytes, skipValidation = false) {
    abytes3(bytes);
    const { _lengths: allowedLengths, BYTES, isLE: isLE2, ORDER, _mod: modFromBytes } = this;
    if (allowedLengths) {
      if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
        throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
      }
      const padded = new Uint8Array(BYTES);
      padded.set(bytes, isLE2 ? 0 : padded.length - bytes.length);
      bytes = padded;
    }
    if (bytes.length !== BYTES)
      throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
    let scalar = isLE2 ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
    if (modFromBytes)
      scalar = mod(scalar, ORDER);
    if (!skipValidation) {
      if (!this.isValid(scalar))
        throw new Error("invalid field element: outside of range 0..ORDER");
    }
    return scalar;
  }
  // TODO: we don't need it here, move out to separate fn
  invertBatch(lst) {
    return FpInvertBatch(this, lst, true);
  }
  // We can't move this out because Fp6, Fp12 implement it
  // and it's unclear what to return in there.
  cmov(a, b, condition) {
    abool2(condition, "condition");
    return condition ? b : a;
  }
};
function Field(ORDER, opts = {}) {
  Object.freeze(_Field.prototype);
  return new _Field(ORDER, opts);
}
function getFieldBytesLength(fieldOrder) {
  if (typeof fieldOrder !== "bigint")
    throw new Error("field order must be bigint");
  if (fieldOrder <= _1n2)
    throw new Error("field order must be greater than 1");
  const bitLength = bitLen(fieldOrder - _1n2);
  return Math.ceil(bitLength / 8);
}
function getMinHashLength(fieldOrder) {
  const length2 = getFieldBytesLength(fieldOrder);
  return length2 + Math.ceil(length2 / 2);
}
function mapHashToField(key, fieldOrder, isLE2 = false) {
  abytes3(key);
  const len = key.length;
  const fieldLen = getFieldBytesLength(fieldOrder);
  const minLen = Math.max(getMinHashLength(fieldOrder), 16);
  if (len < minLen || len > 1024)
    throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
  const num = isLE2 ? bytesToNumberLE(key) : bytesToNumberBE(key);
  const reduced = mod(num, fieldOrder - _1n2) + _1n2;
  return isLE2 ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
}

// node_modules/@noble/curves/abstract/curve.js
var _0n3 = /* @__PURE__ */ BigInt(0);
var _1n3 = /* @__PURE__ */ BigInt(1);
var _4n2 = /* @__PURE__ */ BigInt(4);
var BLIND_BYTES = 16;
var BLIND_BITS = 128;
var FW_WINDOW = 5;
var TABLE_BYTES_MAX = /* @__PURE__ */ (() => 2 ** 31)();
function validatePointCons(Point) {
  const pc = Point;
  if (typeof pc !== "function")
    throw new TypeError('"Point" expected constructor, got type=' + typeof Point);
  afunction(pc.fromAffine, "Point.fromAffine");
  afunction(pc.fromBytes, "Point.fromBytes");
  afunction(pc.fromHex, "Point.fromHex");
  aobject3(pc.BASE, "Point.BASE");
  aobject3(pc.ZERO, "Point.ZERO");
  validateField(pc.Fp);
  validateField(pc.Fn);
}
function normalizeZ(c, points) {
  validatePointCons(c);
  validateMSMPoints(points, c);
  const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits, min = 1) {
  if (!Number.isSafeInteger(W) || W < min || W > bits)
    throw new Error("invalid window size, expected [" + min + ".." + bits + "], got W=" + W);
}
function validateTableBytes(numPoints, fpBytes) {
  const bytes = numPoints * (4 * fpBytes + 128);
  if (bytes > TABLE_BYTES_MAX)
    throw new Error("invalid window size: table would need ~" + Math.ceil(bytes / 2 ** 20) + " MiB, max " + TABLE_BYTES_MAX / 2 ** 20 + " MiB");
}
function probeRandomBytes(randomBytes5, length2) {
  if (randomBytes5 === void 0)
    return void 0;
  afunction(randomBytes5, "randomBytes");
  try {
    const probe = randomBytes5(length2);
    if (!isBytes3(probe) || probe.length !== length2)
      return void 0;
  } catch {
    return void 0;
  }
  return randomBytes5;
}
function validateMSMPoints(points, c) {
  aarray(points, "points");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars(scalars, field, maxScalar) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    const ok = maxScalar === void 0 ? field.isValid(s) : isPosBig(s) && s < maxScalar;
    if (!ok)
      throw new Error("invalid scalar at index " + i);
  });
}
var pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getWindowSize(P) {
  return pointWindowSizes.get(P) || 1;
}
function oddMultiples(p, size) {
  const dbl = p.double();
  const t = [p];
  for (let j = 1; j < size; j++)
    t.push(t[j - 1].add(dbl));
  return t;
}
function wnafDigits(n, W) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const d = [];
  while (n > _0n3) {
    let w = 0;
    if (n & _1n3) {
      w = Number(n & mask);
      if (w >= half)
        w -= size;
      n -= BigInt(w);
    }
    d.push(w);
    n >>= _1n3;
  }
  return d;
}
function signedWindowDigits(n, W, windows) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const shiftBy = BigInt(W);
  const d = [];
  for (let w = 0; w < windows; w++) {
    let v = Number(n & mask);
    n >>= shiftBy;
    if (v > half) {
      v -= size;
      n += _1n3;
    }
    d.push(v);
  }
  if (n !== _0n3)
    throw new Error("invalid wnaf");
  return d;
}
function wnafWalk(zero, tables, digits) {
  let max = 0;
  for (const d of digits)
    max = Math.max(max, d.length);
  let acc = zero;
  for (let bit = max - 1; bit >= 0; bit--) {
    if (bit !== max - 1)
      acc = acc.double();
    for (let i = 0; i < digits.length; i++) {
      const w = digits[i][bit];
      if (w) {
        const item = tables[i][Math.abs(w) - 1 >> 1];
        acc = acc.add(w < 0 ? item.negate() : item);
      }
    }
  }
  return acc;
}
var ScalarMultiplier = class {
  Point;
  BASE;
  ZERO;
  randomBytes;
  wnafPrecomputes = /* @__PURE__ */ new WeakMap();
  baseCanBeBlinded;
  bits;
  // Parametrized with a given Point class (not individual point)
  constructor(Point, randomBytes5) {
    validatePointCons(Point);
    this.randomBytes = probeRandomBytes(randomBytes5, BLIND_BYTES);
    this.Point = Point;
    this.BASE = Point.BASE;
    this.ZERO = Point.ZERO;
    this.bits = Point.Fn.BITS;
  }
  /**
   * Creates a signed fixed-window wNAF precomputation table: for every window w, the
   * multiples `[1..2^(W−1)]⋅2^(w⋅W)⋅P`, flattened. All doublings are baked into the table,
   * so cached multiplication is additions-only. `windows = ceil(bits/W) + 1`: the extra
   * window absorbs the final carry of signed-digit recoding.
   * For a 256-bit curve and W=6, the table is 44⋅32 = 1408 points.
   * @param point - Point instance
   * @param W - window size
   * @param bits - scalar bitlength the table must cover
   */
  buildWnafTable(point, W, bits) {
    const windows = Math.ceil(bits / W) + 1;
    const half = 2 ** (W - 1);
    const comp = [];
    let base = point;
    for (let w = 0; w < windows; w++) {
      let acc = base;
      for (let i = 0; i < half; i++) {
        comp.push(acc);
        acc = acc.add(base);
      }
      base = comp[comp.length - 1].double();
    }
    return { W, bits, windows, comp };
  }
  /**
   * Implements ec multiplication using precomputed signed fixed-window wNAF tables.
   * Constant-time: fixed window count with one table addition per window — zero digits feed
   * the fake accumulator — and no doublings; the lookup scans the whole window slice.
   * Scalar bounds are validated by the public entry points ({@link ScalarMultiplier.mulCT},
   * {@link ScalarMultiplier.mulCTBlinded}, {@link ScalarMultiplier.mulUnsafe});
   * signedWindowDigits throws if `n` exceeds the table.
   * @returns real and fake (for const-time) points
   */
  wnafCachedCT(precomputes, n) {
    const { W, windows, comp } = precomputes;
    const half = 2 ** (W - 1);
    const digits = signedWindowDigits(n, W, windows);
    let p = this.ZERO;
    let f = this.BASE;
    for (let w = 0; w < windows; w++) {
      const digit = digits[w];
      const start = w * half;
      const idx = Math.abs(digit) - 1;
      let sel = comp[start];
      for (let i = 1; i < half; i++)
        sel = i === idx ? comp[start + i] : sel;
      const neg = sel.negate();
      if (digit === 0)
        f = f.add(comp[start]);
      else
        p = p.add(digit < 0 ? neg : sel);
    }
    return { p, f };
  }
  // Cache key is point identity plus (W, bits); at most two entries exist per point (public-width
  // `Fn.BITS` and blinded `Fn.BITS + BLIND_BITS`). Callers must not reuse the same point with
  // incompatible `transform(...)` layouts and expect a separate cache entry.
  getWnafPrecomputes(W, point, bits, transform) {
    let entries = this.wnafPrecomputes.get(point);
    let comp = entries?.find((entry) => entry.W === W && entry.bits === bits);
    if (!comp) {
      comp = this.buildWnafTable(point, W, bits);
      if (typeof transform === "function")
        comp = { ...comp, comp: transform(comp.comp) };
      if (!entries) {
        entries = [];
        this.wnafPrecomputes.set(point, entries);
      }
      entries.push(comp);
    }
    return comp;
  }
  assertPoint(point) {
    if (!(point instanceof this.Point))
      throw new TypeError('"point" expected Point instance, got type=' + typeof point);
  }
  // Shared prologue of the constant-time entry points. Rejects scalar 0: in key/signature-style
  // callers a zero scalar means broken upstream plumbing, and concrete Points already reject it.
  // Uses inRange instead of Fn.isValidNot0: validateField() only certifies the arithmetic subset.
  validateMulInput(point, scalar) {
    this.assertPoint(point);
    if (!inRange(scalar, _1n3, this.Point.Fn.ORDER))
      throw new Error("invalid scalar");
  }
  // Constant-time dispatch shared by mulCT / mulCTBlinded. Un-precomputed points (W===1, e.g.
  // ECDH peer keys) skip building a throwaway cached table in favor of a small fixed-window
  // multiply. `n` must be < 2^bits.
  runCT(point, n, bits, transform) {
    const W = getWindowSize(point);
    if (W === 1)
      return this.fixedWindowCT(point, n, bits);
    return this.wnafCachedCT(this.getWnafPrecomputes(W, point, bits, transform), n);
  }
  mulCT(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    return this.runCT(point, scalar, this.bits, transform);
  }
  mulCTBlinded(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    if (this.randomBytes === void 0)
      throw new Error("randomBytes is required for scalar blinding");
    const bits = this.Point.Fn.BITS + BLIND_BITS;
    const blind = this.randomBytes(BLIND_BYTES);
    if (!isBytes3(blind) || blind.length !== BLIND_BYTES)
      throw new Error("randomBytes returned invalid byte array");
    blind[0] = blind[0] & 63 | 128;
    const n = scalar + bytesToNumberBE(blind) * this.Point.Fn.ORDER;
    return this.runCT(point, n, bits, transform);
  }
  /**
   * Constant-time multiplication `n*point` for an un-precomputed point, via a small fixed window.
   * A cached wNAF table only pays off when reused; a flat 2^FW_WINDOW table (`size-1` adds) is
   * far cheaper to build for a single use. The point-operation sequence is independent of `n`:
   * build the table, then per window exactly FW_WINDOW doublings, a data-oblivious scan over
   * every table entry, and one addition (adds the identity when the window digit is 0 — never
   * skipped).
   *
   * `n` must be `< 2^bits`. Assumes complete addition (adding the identity costs the same as any
   * add), which holds for the Weierstrass/Edwards point types used here. The table is left in
   * projective form (no normalizeZ): normalizing this small a table costs more than the
   * mixed-add savings it would buy for a single multiply.
   * @returns real point `p`; `f` duplicates it only to match {@link wnafCachedCT}'s return shape
   * (this path needs no fake accumulator — its op-count is already scalar-independent).
   */
  fixedWindowCT(point, n, bits) {
    const W = FW_WINDOW;
    const size = 1 << W;
    const mask = bitMask(W);
    const table = new Array(size);
    table[0] = this.ZERO;
    for (let i = 1; i < size; i++)
      table[i] = table[i - 1].add(point);
    const windows = Math.ceil(bits / W);
    let acc = this.ZERO;
    for (let window = windows - 1; window >= 0; window--) {
      if (window !== windows - 1)
        for (let d = 0; d < W; d++)
          acc = acc.double();
      const digit = Number(n >> BigInt(window * W) & mask);
      let sel = table[0];
      for (let i = 1; i < size; i++)
        sel = i === digit ? table[i] : sel;
      acc = acc.add(sel);
    }
    return { p: acc, f: acc };
  }
  shouldBlind(point, cofactor) {
    if (this.randomBytes === void 0)
      return false;
    if (cofactor === _1n3)
      return true;
    if (point !== this.BASE)
      return false;
    if (this.baseCanBeBlinded === void 0)
      this.baseCanBeBlinded = this.mulUnsafe(this.BASE, this.Point.Fn.ORDER).is0();
    return this.baseCanBeBlinded;
  }
  mulSecret(point, scalar, cofactor, transform) {
    return this.shouldBlind(point, cofactor) ? this.mulCTBlinded(point, scalar, transform) : this.mulCT(point, scalar, transform);
  }
  mulUnsafe(point, scalar, transform) {
    this.assertPoint(point);
    if (!isPosBig(scalar))
      throw new Error("invalid scalar");
    const W = getWindowSize(point);
    if (W === 1 || scalar >= this.Point.Fn.ORDER)
      return mulAddUnsafe(this.Point, [point], [scalar], true);
    const precomputes = this.getWnafPrecomputes(W, point, this.bits, transform);
    return this.wnafCachedCT(precomputes, scalar).p;
  }
  // Remembers the window size used for precomputed wNAF multiplication of the given point
  // and drops any previously built tables. Usually only the base point is precomputed.
  // W=1 resets the point to the un-precomputed (table-less) paths.
  // W is additionally capped so tables stay under ~2 GiB ({@link TABLE_BYTES_MAX}).
  setWindowSize(point, W) {
    this.assertPoint(point);
    validateW(W, this.bits);
    const windows = Math.ceil((this.bits + BLIND_BITS) / W) + 1;
    validateTableBytes(windows * 2 ** (W - 1), this.Point.Fp.BYTES);
    pointWindowSizes.set(point, W);
    this.wnafPrecomputes.delete(point);
  }
  // True when a window size is set: tables themselves are built lazily on first multiply.
  hasWindowSize(point) {
    return getWindowSize(point) !== 1;
  }
};
function mulAddUnsafe(c, points, scalars, allowOversized = false) {
  validatePointCons(c);
  validateMSMPoints(points, c);
  abool2(allowOversized, "allowOversized");
  validateMSMScalars(scalars, c.Fn, allowOversized ? c.Fn.ORDER ** _4n2 : void 0);
  if (points.length !== scalars.length)
    throw new Error("arrays of points and scalars must have equal length");
  const tables = points.map((p) => oddMultiples(p, 4));
  const digits = scalars.map((n) => wnafDigits(n, 4));
  return wnafWalk(c.ZERO, tables, digits);
}
function createField(order, field, isLE2) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField(field);
    return field;
  } else {
    return Field(order, { isLE: isLE2 });
  }
}
function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (type !== "weierstrass" && type !== "edwards")
    throw new Error('expected curve type "weierstrass" or "edwards"');
  if (FpFnLE === void 0)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  validateObject(curveOpts);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(isPosBig(val) && val !== _0n3))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp, Fn };
}
function createKeygen(randomSecretKey, getPublicKey) {
  return function keygen(seed) {
    const secretKey = randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  };
}

// node_modules/@noble/curves/abstract/edwards.js
var _0n4 = /* @__PURE__ */ BigInt(0);
var _1n4 = /* @__PURE__ */ BigInt(1);
var _2n2 = /* @__PURE__ */ BigInt(2);
var _4n3 = /* @__PURE__ */ BigInt(4);
var _8n2 = /* @__PURE__ */ BigInt(8);
function isEdValidXY(Fp, CURVE, x, y) {
  const x2 = Fp.sqr(x);
  const y2 = Fp.sqr(y);
  const left = Fp.add(Fp.mul(CURVE.a, x2), y2);
  const right = Fp.add(Fp.ONE, Fp.mul(CURVE.d, Fp.mul(x2, y2)));
  return Fp.eql(left, right);
}
function edwards(params, extraOpts = {}) {
  validateObject(extraOpts, {}, {}, "extraOpts");
  const opts = extraOpts;
  const validated = createCurveFields("edwards", params, opts, opts.FpFnLE);
  const { Fp, Fn } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor } = CURVE;
  if (FpLegendre(Fp, CURVE.a) !== 1)
    throw new Error("edwards: CURVE.a must be a square in Fp for complete addition formulas");
  if (FpLegendre(Fp, CURVE.d) !== -1)
    throw new Error("edwards: CURVE.d must be a non-square in Fp for complete addition formulas");
  validateObject(opts, {}, { uvRatio: "function", randomBytes: "function" });
  const randomBytes5 = opts.randomBytes === void 0 ? randomBytes3 : opts.randomBytes;
  const MASK = _2n2 << BigInt(Fp.BYTES * 8) - _1n4;
  function isOdd(n) {
    if (!Fp.isOdd)
      throw new Error("Field does not have .isOdd()");
    return Fp.isOdd(n);
  }
  const uvRatio2 = opts.uvRatio === void 0 ? (u, v) => {
    try {
      return { isValid: true, value: Fp.sqrt(Fp.div(u, v)) };
    } catch (e) {
      return { isValid: false, value: _0n4 };
    }
  } : opts.uvRatio;
  if (!isEdValidXY(Fp, CURVE, CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const mulA = Fp.eql(CURVE.a, Fp.neg(Fp.ONE)) ? (x) => Fp.neg(x) : Fp.eql(CURVE.a, Fp.ONE) ? (x) => x : (x) => Fp.mul(CURVE.a, x);
  function acoord(title, n, banZero = false) {
    const min = banZero ? _1n4 : _0n4;
    aInRange("coordinate " + title, n, min, MASK);
    return n;
  }
  function aedpoint(other) {
    if (!(other instanceof Point))
      throw new Error("EdwardsPoint expected");
  }
  class Point {
    static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE, Fp.mul(CURVE.Gx, CURVE.Gy));
    static ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ONE, Fp.ZERO);
    static Fp = Fp;
    static Fn = Fn;
    X;
    Y;
    Z;
    T;
    constructor(X, Y, Z, T) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y);
      this.Z = acoord("z", Z, true);
      this.T = acoord("t", T);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    /**
     * Create one extended Edwards point from affine coordinates.
     * Does NOT validate that the point is on-curve or torsion-free.
     * Use `.assertValidity()` on adversarial inputs.
     */
    static fromAffine(p) {
      if (p instanceof Point)
        throw new Error("extended point not allowed");
      const { x, y } = p || {};
      acoord("x", x);
      acoord("y", y);
      return new Point(x, y, Fp.ONE, Fp.mul(x, y));
    }
    // Uses algo from RFC8032 5.1.3.
    static fromBytes(bytes, zip215 = false) {
      const len = Fp.BYTES;
      const { a, d } = CURVE;
      bytes = copyBytes2(abytes3(bytes, len, "point"));
      abool2(zip215, "zip215");
      const normed = copyBytes2(bytes);
      const lastByte = bytes[len - 1];
      normed[len - 1] = lastByte & ~128;
      const y = bytesToNumberLE(normed);
      const max = zip215 ? MASK : Fp.ORDER;
      aInRange("point.y", y, _0n4, max);
      const y2 = Fp.sqr(y);
      const u = Fp.sub(y2, Fp.ONE);
      const v = Fp.sub(Fp.mulN(d, y2), a);
      let { isValid, value: x } = uvRatio2(u, v);
      if (!isValid)
        throw new Error("bad point: invalid y coordinate");
      const isXOdd = isOdd(x);
      const isLastByteOdd = (lastByte & 128) !== 0;
      if (!zip215 && Fp.is0(x) && isLastByteOdd)
        throw new Error("bad point: x=0 and x_0=1");
      if (isLastByteOdd !== isXOdd)
        x = Fp.neg(x);
      return Point.fromAffine({ x, y });
    }
    static fromHex(hex, zip215 = false) {
      return Point.fromBytes(hexToBytes2(hex), zip215);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    precompute(windowSize = 6, isLazy = true) {
      wnaf.setWindowSize(this, windowSize);
      if (!isLazy)
        this.multiply(_2n2);
      return this;
    }
    // Useful in fromAffine() - not for fromBytes(), which always created valid points.
    assertValidity() {
      const p = this;
      const { a, d } = CURVE;
      if (p.is0())
        throw new Error("bad point: ZERO");
      const { X, Y, Z, T } = p;
      const X2 = Fp.sqr(X);
      const Y2 = Fp.sqr(Y);
      const Z2 = Fp.sqr(Z);
      const Z4 = Fp.sqr(Z2);
      const aX2 = Fp.mul(X2, a);
      const left = Fp.mul(Fp.add(aX2, Y2), Z2);
      const right = Fp.add(Z4, Fp.mul(d, Fp.mul(X2, Y2)));
      if (!Fp.eql(left, right))
        throw new Error("bad point: equation left != right (1)");
      const XY = Fp.mul(X, Y);
      const ZT = Fp.mul(Z, T);
      if (!Fp.eql(XY, ZT))
        throw new Error("bad point: equation left != right (2)");
    }
    // Compare one point to another.
    equals(other) {
      aedpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const X1Z2 = Fp.mul(X1, Z2);
      const X2Z1 = Fp.mul(X2, Z1);
      const Y1Z2 = Fp.mul(Y1, Z2);
      const Y2Z1 = Fp.mul(Y2, Z1);
      return Fp.eql(X1Z2, X2Z1) && Fp.eql(Y1Z2, Y2Z1);
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    negate() {
      return new Point(Fp.neg(this.X), this.Y, this.Z, Fp.neg(this.T));
    }
    // Fast algo for doubling Extended Point.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#doubling-dbl-2008-hwcd
    // Cost: 4M + 4S + 1*a + 6add + 1*2.
    double() {
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const A = Fp.sqr(X1);
      const B = Fp.sqr(Y1);
      const C = Fp.mul(Fp.sqr(Z1), _2n2);
      const D = mulA(A);
      const x1y1 = Fp.addN(X1, Y1);
      const E = Fp.sub(Fp.subN(Fp.sqr(x1y1), A), B);
      const G = Fp.addN(D, B);
      const F = Fp.subN(G, C);
      const H = Fp.subN(D, B);
      const X3 = Fp.mul(E, F);
      const Y3 = Fp.mul(G, H);
      const T3 = Fp.mul(E, H);
      const Z3 = Fp.mul(F, G);
      return new Point(X3, Y3, Z3, T3);
    }
    // Fast algo for adding 2 Extended Points.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#addition-add-2008-hwcd
    // Cost: 9M + 1*a + 1*d + 7add.
    add(other) {
      aedpoint(other);
      const { d } = CURVE;
      const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
      const { X: X2, Y: Y2, Z: Z2, T: T2 } = other;
      const A = Fp.mul(X1, X2);
      const B = Fp.mul(Y1, Y2);
      const C = Fp.mul(Fp.mulN(T1, d), T2);
      const D = Fp.mul(Z1, Z2);
      const E = Fp.sub(Fp.subN(Fp.mulN(Fp.addN(X1, Y1), Fp.addN(X2, Y2)), A), B);
      const F = Fp.subN(D, C);
      const G = Fp.addN(D, C);
      const H = Fp.sub(B, mulA(A));
      const X3 = Fp.mul(E, F);
      const Y3 = Fp.mul(G, H);
      const T3 = Fp.mul(E, H);
      const Z3 = Fp.mul(F, G);
      return new Point(X3, Y3, Z3, T3);
    }
    subtract(other) {
      aedpoint(other);
      return this.add(other.negate());
    }
    // Constant-time multiplication.
    multiply(scalar) {
      if (!Fn.isValidNot0(scalar))
        throw new RangeError("invalid scalar: expected 1 <= sc < curve.n");
      const { p, f } = wnaf.mulSecret(this, scalar, cofactor, normalize);
      return normalize([p, f])[0];
    }
    // Non-constant-time multiplication. Uses double-and-add algorithm.
    // It's faster, but should only be used when you don't care about
    // an exposed private key e.g. sig verification.
    // Keeps the same subgroup-scalar contract: 0 is allowed for public-scalar callers, but
    // n and larger values are rejected instead of being reduced mod n to the identity point.
    multiplyUnsafe(scalar) {
      if (!Fn.isValid(scalar))
        throw new RangeError("invalid scalar: expected 0 <= sc < curve.n");
      if (scalar === _0n4)
        return Point.ZERO;
      if (this.is0() || scalar === _1n4)
        return this;
      return wnaf.mulUnsafe(this, scalar, normalize);
    }
    // Checks if point is of small order.
    // If you add something to small order point, you will have "dirty"
    // point with torsion component.
    // Clears cofactor and checks if the result is 0.
    isSmallOrder() {
      return this.clearCofactor().is0();
    }
    // Multiplies point by curve order and checks if the result is 0.
    // Returns `false` is the point is dirty.
    isTorsionFree() {
      return wnaf.mulUnsafe(this, CURVE.n).is0();
    }
    // Converts Extended point to default (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    toAffine(invertedZ) {
      const p = this;
      let iz = invertedZ;
      if (iz != null && typeof iz !== "bigint")
        throw new TypeError('"invertedZ" expected bigint, got type=' + typeof iz);
      const { X, Y, Z } = p;
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? Fp.create(_8n2) : Fp.inv(Z);
      const x = Fp.mul(X, iz);
      const y = Fp.mul(Y, iz);
      const zz = Fp.mul(Z, iz);
      if (is0)
        return { x: Fp.ZERO, y: Fp.ONE };
      if (!Fp.eql(zz, Fp.ONE))
        throw new Error("invZ was invalid");
      return { x, y };
    }
    clearCofactor() {
      if (cofactor === _1n4)
        return this;
      if (cofactor === _2n2)
        return this.double();
      if (cofactor === _4n3)
        return this.double().double();
      if (cofactor === _8n2)
        return this.double().double().double();
      return this.multiplyUnsafe(cofactor);
    }
    toBytes() {
      const { x, y } = this.toAffine();
      const bytes = Fp.toBytes(y);
      bytes[bytes.length - 1] |= isOdd(x) ? 128 : 0;
      return bytes;
    }
    toHex() {
      return bytesToHex2(this.toBytes());
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  }
  const normalize = (points) => normalizeZ(Point, points);
  const wnaf = new ScalarMultiplier(Point, randomBytes5);
  if (wnaf.bits >= 6)
    Point.BASE.precompute(6);
  Object.freeze(Point.prototype);
  Object.freeze(Point);
  return Point;
}

// node_modules/@noble/curves/abstract/montgomery.js
var _0n5 = /* @__PURE__ */ BigInt(0);
var _1n5 = /* @__PURE__ */ BigInt(1);
var _2n3 = /* @__PURE__ */ BigInt(2);
function cmask(P, swap) {
  return P + swap - (swap >> _1n5 << _1n5);
}
function cswap(P) {
  const offset = BigInt(6) * P;
  return (mask, x_2, x_3) => {
    const sum = x_2 + x_3;
    const d = offset + x_3 - x_2;
    const a = (d * mask + x_2) % P;
    return { x_2: a, x_3: sum - a };
  };
}
function validateOpts(curve) {
  validateObject(curve, {
    P: "bigint",
    type: "string",
    adjustScalarBytes: "function",
    powPminus2: "function"
  }, {
    randomBytes: "function",
    scalarMultBase: "function"
  });
  return Object.freeze({ ...curve });
}
function montgomery(curveDef) {
  const CURVE = validateOpts(curveDef);
  const { P, type, adjustScalarBytes: adjustScalarBytes2, powPminus2, randomBytes: rand } = CURVE;
  const mulBaseHook = CURVE.scalarMultBase;
  const is25519 = type === "x25519";
  if (!is25519 && type !== "x448")
    throw new Error("invalid type");
  const randomBytes_ = rand === void 0 ? randomBytes3 : rand;
  const montgomeryBits = is25519 ? 255 : 448;
  const swap = cswap(P);
  const fieldLen = is25519 ? 32 : 56;
  const Gu = is25519 ? BigInt(9) : BigInt(5);
  const a24 = is25519 ? BigInt(121665) : BigInt(39081);
  const minScalar = is25519 ? _2n3 ** BigInt(254) : _2n3 ** BigInt(447);
  const maxAdded = is25519 ? BigInt(8) * (_2n3 ** BigInt(251) - _1n5) : BigInt(4) * (_2n3 ** BigInt(445) - _1n5);
  const maxScalar = minScalar + maxAdded + _1n5;
  const modP = (n) => mod(n, P);
  const GuBytes = encodeU(Gu);
  function encodeU(u) {
    return numberToBytesLE(modP(u), fieldLen);
  }
  function decodeU(u) {
    const _u = copyBytes2(abytes3(u, fieldLen, "uCoordinate"));
    if (is25519)
      _u[31] &= 127;
    return modP(bytesToNumberLE(_u));
  }
  function decodeScalar(scalar) {
    return bytesToNumberLE(adjustScalarBytes2(copyBytes2(abytes3(scalar, fieldLen, "scalar"))));
  }
  const lowOrderU = new Set(is25519 ? [
    _0n5,
    _1n5,
    P - _1n5,
    BigInt("325606250916557431795983626356110631294008115727848805560023387167927233504"),
    BigInt("39382357235489614581723060781553021112529911719440698176882885853963445705823")
  ] : [_0n5, _1n5, P - _1n5]);
  function scalarMult(scalar, u) {
    const pointU = decodeU(u);
    if (lowOrderU.has(pointU))
      throw new Error("invalid private or public key received");
    const pu = montgomeryLadder(pointU, decodeScalar(scalar));
    if (pu === _0n5)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  function scalarMultBase(scalar) {
    if (mulBaseHook === void 0)
      return scalarMult(scalar, GuBytes);
    const k = decodeScalar(scalar);
    aInRange("scalar", k, minScalar, maxScalar);
    const pu = modP(mulBaseHook(k));
    if (pu === _0n5)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  const getPublicKey = scalarMultBase;
  const getSharedSecret = scalarMult;
  function montgomeryLadder(u, scalar) {
    aInRange("u", u, _0n5, P);
    aInRange("scalar", scalar, minScalar, maxScalar);
    const k = scalar;
    const x_1 = u;
    let x_2 = _1n5;
    let z_2 = _0n5;
    let x_3 = u;
    let z_3 = _1n5;
    const kx = k ^ k >> _1n5;
    for (let t = BigInt(montgomeryBits - 1); t >= _0n5; t--) {
      const mask2 = cmask(P, kx >> t);
      ({ x_2, x_3 } = swap(mask2, x_2, x_3));
      ({ x_2: z_2, x_3: z_3 } = swap(mask2, z_2, z_3));
      const A = x_2 + z_2;
      const AA = modP(A * A);
      const B = x_2 - z_2;
      const BB = modP(B * B);
      const E = AA - BB;
      const C = x_3 + z_3;
      const D = x_3 - z_3;
      const DA = modP(D * A);
      const CB = modP(C * B);
      const dacb = DA + CB;
      const da_cb = DA - CB;
      x_3 = modP(dacb * dacb);
      z_3 = modP(x_1 * modP(da_cb * da_cb));
      x_2 = modP(AA * BB);
      z_2 = modP(E * (AA + modP(a24 * E)));
    }
    const mask = cmask(P, k);
    ({ x_2, x_3 } = swap(mask, x_2, x_3));
    ({ x_2: z_2, x_3: z_3 } = swap(mask, z_2, z_3));
    const z2 = powPminus2(z_2);
    return modP(x_2 * z2);
  }
  const lengths = {
    secretKey: fieldLen,
    publicKey: fieldLen,
    seed: fieldLen
  };
  const randomSecretKey = (seed) => {
    seed = seed === void 0 ? randomBytes_(fieldLen) : seed;
    abytes3(seed, lengths.seed, "seed");
    return seed;
  };
  const utils = { randomSecretKey };
  Object.freeze(lengths);
  Object.freeze(utils);
  return Object.freeze({
    keygen: createKeygen(randomSecretKey, getPublicKey),
    getSharedSecret,
    getPublicKey,
    scalarMult,
    scalarMultBase,
    utils,
    GuBytes: GuBytes.slice(),
    lengths
  });
}

// node_modules/@noble/curves/ed25519.js
var _0n6 = /* @__PURE__ */ BigInt(0);
var _1n6 = /* @__PURE__ */ BigInt(1);
var _2n4 = /* @__PURE__ */ BigInt(2);
var _3n2 = /* @__PURE__ */ BigInt(3);
var _5n2 = /* @__PURE__ */ BigInt(5);
var _8n3 = /* @__PURE__ */ BigInt(8);
var ed25519_CURVE_p = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
var ed25519_CURVE = /* @__PURE__ */ (() => ({
  p: ed25519_CURVE_p,
  n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"),
  h: _8n3,
  a: BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec"),
  d: BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3"),
  Gx: BigInt("0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"),
  Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658")
}))();
function ed25519_pow_2_252_3(x) {
  const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
  const P = ed25519_CURVE_p;
  const x2 = x * x % P;
  const b2 = x2 * x % P;
  const b4 = pow2(b2, _2n4, P) * b2 % P;
  const b5 = pow2(b4, _1n6, P) * x % P;
  const b10 = pow2(b5, _5n2, P) * b5 % P;
  const b20 = pow2(b10, _10n, P) * b10 % P;
  const b40 = pow2(b20, _20n, P) * b20 % P;
  const b80 = pow2(b40, _40n, P) * b40 % P;
  const b160 = pow2(b80, _80n, P) * b80 % P;
  const b240 = pow2(b160, _80n, P) * b80 % P;
  const b250 = pow2(b240, _10n, P) * b10 % P;
  const pow_p_5_8 = pow2(b250, _2n4, P) * x % P;
  return { pow_p_5_8, b2 };
}
function adjustScalarBytes(bytes) {
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;
  return bytes;
}
var ED25519_SQRT_M1 = /* @__PURE__ */ BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
function uvRatio(u, v) {
  const P = ed25519_CURVE_p;
  const v3 = mod(v * v * v, P);
  const v7 = mod(v3 * v3 * v, P);
  const pow3 = ed25519_pow_2_252_3(u * v7).pow_p_5_8;
  let x = mod(u * v3 * pow3, P);
  const vx2 = mod(v * x * x, P);
  const root1 = x;
  const root2 = mod(x * ED25519_SQRT_M1, P);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === mod(-u, P);
  const noRoot = vx2 === mod(-u * ED25519_SQRT_M1, P);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if (isNegativeLE(x, P))
    x = mod(-x, P);
  return { isValid: useRoot1 || useRoot2, value: x };
}
var ed25519_Point = /* @__PURE__ */ edwards(ed25519_CURVE, { uvRatio });
var x25519 = /* @__PURE__ */ (() => {
  const P = ed25519_CURVE_p;
  const powPminus2 = (x) => {
    const { pow_p_5_8, b2 } = ed25519_pow_2_252_3(x);
    return mod(pow2(pow_p_5_8, _3n2, P) * b2, P);
  };
  return montgomery({
    P,
    type: "x25519",
    powPminus2,
    adjustScalarBytes,
    // ~3x faster fixed-base: [k]B on the birationally-equivalent Edwards curve using cached
    // base tables, mapped back via u = (1+y)/(1-y) = (Z+Y)/(Z-Y) with one Fermat inversion.
    // Same construction as libsodium's crypto_scalarmult_curve25519_base.
    scalarMultBase: (k) => {
      const kn = mod(k, ed25519_Point.Fn.ORDER);
      if (kn === _0n6)
        return _0n6;
      const p = ed25519_Point.BASE.multiply(kn);
      return mod((p.Z + p.Y) * powPminus2(mod(p.Z - p.Y, P)), P);
    }
  });
})();

// node_modules/@noble/curves/abstract/der.js
var _0n7 = /* @__PURE__ */ BigInt(0);
var DERErr = class extends Error {
  constructor(m = "") {
    super(m);
  }
};
var _DER = {
  // asn.1 DER encoding utils
  Err: DERErr,
  // Basic building block is TLV (Tag-Length-Value)
  _tlv: {
    encode: (tag, data) => {
      const { Err: E } = _DER;
      asafenumber(tag, "tag");
      if (tag < 0 || tag > 255)
        throw new E("tlv.encode: wrong tag");
      astring(data, "data");
      if (data.length & 1)
        throw new E("tlv.encode: unpadded data");
      const dataLen = data.length / 2;
      const len = numberToHexUnpadded(dataLen);
      if (len.length / 2 & 128)
        throw new E("tlv.encode: long form length too big");
      const lenLen = dataLen > 127 ? numberToHexUnpadded(len.length / 2 | 128) : "";
      const t = numberToHexUnpadded(tag);
      return t + lenLen + len + data;
    },
    // v - value, l - left bytes (unparsed)
    decode(tag, data) {
      const { Err: E } = _DER;
      data = abytes3(data, void 0, "DER data");
      let pos = 0;
      if (tag < 0 || tag > 255)
        throw new E("tlv.decode: wrong tag");
      if (data.length < 2 || data[pos++] !== tag)
        throw new E("tlv.decode: wrong tlv");
      const first = data[pos++];
      const isLong = !!(first & 128);
      let length2 = 0;
      if (!isLong)
        length2 = first;
      else {
        const lenLen = first & 127;
        if (!lenLen)
          throw new E("tlv.decode(long): indefinite length not supported");
        if (lenLen > 4)
          throw new E("tlv.decode(long): byte length is too big");
        const lengthBytes = data.subarray(pos, pos + lenLen);
        if (lengthBytes.length !== lenLen)
          throw new E("tlv.decode: length bytes not complete");
        if (lengthBytes[0] === 0)
          throw new E("tlv.decode(long): zero leftmost byte");
        for (const b of lengthBytes)
          length2 = length2 << 8 | b;
        pos += lenLen;
        if (length2 < 128)
          throw new E("tlv.decode(long): not minimal encoding");
      }
      const v = data.subarray(pos, pos + length2);
      if (v.length !== length2)
        throw new E("tlv.decode: wrong value length");
      return { v, l: data.subarray(pos + length2) };
    }
  },
  // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
  // since we always use positive integers here. It must always be empty:
  // - add zero byte if exists
  // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
  _int: {
    encode(num) {
      const { Err: E } = _DER;
      abignumber(num);
      if (num < _0n7)
        throw new E("integer: negative integers are not allowed");
      let hex = numberToHexUnpadded(num);
      if (Number.parseInt(hex[0], 16) & 8)
        hex = "00" + hex;
      if (hex.length & 1)
        throw new E("unexpected DER parsing assertion: unpadded hex");
      return hex;
    },
    decode(data) {
      const { Err: E } = _DER;
      if (data.length < 1)
        throw new E("invalid signature integer: empty");
      if (data[0] & 128)
        throw new E("invalid signature integer: negative");
      if (data.length > 1 && data[0] === 0 && !(data[1] & 128))
        throw new E("invalid signature integer: unnecessary leading zero");
      return bytesToNumberBE(data);
    }
  },
  toSig(bytes) {
    const { Err: E, _int: int, _tlv: tlv } = _DER;
    const data = abytes3(bytes, void 0, "signature");
    const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
    if (seqLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    const { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes);
    const { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
    if (sLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    return { r: int.decode(rBytes), s: int.decode(sBytes) };
  },
  hexFromSig(sig) {
    const { _tlv: tlv, _int: int } = _DER;
    validateObject(sig, { r: "bigint", s: "bigint" }, {}, "sig");
    const rs = tlv.encode(2, int.encode(sig.r));
    const ss = tlv.encode(2, int.encode(sig.s));
    const seq = rs + ss;
    return tlv.encode(48, seq);
  }
};
var DER = /* @__PURE__ */ (() => {
  Object.freeze(_DER._tlv);
  Object.freeze(_DER._int);
  return Object.freeze(_DER);
})();

// node_modules/@noble/curves/abstract/weierstrass.js
var divNearest = (num, den) => (num + (num >= 0 ? den : -den) / _2n5) / den;
function _splitEndoScalar(k, basis, n) {
  aInRange("scalar", k, _0n8, n);
  const [[a1, b1], [a2, b2]] = basis;
  const c1 = divNearest(b2 * k, n);
  const c2 = divNearest(-b1 * k, n);
  let k1 = k - c1 * a1 - c2 * a2;
  let k2 = -c1 * b1 - c2 * b2;
  const k1neg = k1 < _0n8;
  const k2neg = k2 < _0n8;
  if (k1neg)
    k1 = -k1;
  if (k2neg)
    k2 = -k2;
  const MAX_NUM = bitMask(Math.ceil(bitLen(n) / 2)) + _1n7;
  if (k1 < _0n8 || k1 >= MAX_NUM || k2 < _0n8 || k2 >= MAX_NUM) {
    throw new Error("splitScalar (endomorphism): failed for k");
  }
  return { k1neg, k1, k2neg, k2 };
}
function validateSigFormat(format) {
  if (!["compact", "recovered", "der"].includes(format))
    throw new Error('Signature format must be "compact", "recovered", or "der"');
  return format;
}
function validateSigOpts(opts, def) {
  validateObject(opts);
  const optsn = {};
  for (let optName of Object.keys(def)) {
    optsn[optName] = opts[optName] === void 0 ? def[optName] : opts[optName];
  }
  abool2(optsn.lowS, "lowS");
  abool2(optsn.prehash, "prehash");
  if (optsn.format !== void 0)
    validateSigFormat(optsn.format);
  return optsn;
}
var _0n8 = /* @__PURE__ */ BigInt(0);
var _1n7 = /* @__PURE__ */ BigInt(1);
var _2n5 = /* @__PURE__ */ BigInt(2);
var _3n3 = /* @__PURE__ */ BigInt(3);
var _4n4 = /* @__PURE__ */ BigInt(4);
function weierstrass(params, extraOpts = {}) {
  const validated = createCurveFields("weierstrass", params, extraOpts);
  const Fp = validated.Fp;
  const Fn = validated.Fn;
  let CURVE = validated.CURVE;
  const { h: cofactor, n: CURVE_ORDER } = CURVE;
  validateObject(extraOpts, {}, {
    allowInfinityPoint: "boolean",
    clearCofactor: "function",
    isTorsionFree: "function",
    fromBytes: "function",
    toBytes: "function",
    endo: "object",
    randomBytes: "function"
  });
  const { endo, allowInfinityPoint } = extraOpts;
  const randomBytes5 = extraOpts.randomBytes === void 0 ? randomBytes3 : extraOpts.randomBytes;
  if (endo) {
    if (!Fp.is0(CURVE.a) || typeof endo.beta !== "bigint" || !Array.isArray(endo.basises)) {
      throw new Error('invalid endo: expected "beta": bigint and "basises": array');
    }
  }
  const lengths = getWLengths(Fp, Fn);
  function assertCompressionIsSupported() {
    if (!Fp.isOdd)
      throw new Error("compression is not supported: Field does not have .isOdd()");
  }
  function pointToBytes(_c, point, isCompressed) {
    if (allowInfinityPoint && point.is0())
      return Uint8Array.of(0);
    const { x, y } = point.toAffine();
    const bx = Fp.toBytes(x);
    abool2(isCompressed, "isCompressed");
    if (isCompressed) {
      assertCompressionIsSupported();
      const hasEvenY = !Fp.isOdd(y);
      return concatBytes3(pprefix(hasEvenY), bx);
    } else {
      return concatBytes3(Uint8Array.of(4), bx, Fp.toBytes(y));
    }
  }
  function pointFromBytes(bytes) {
    abytes3(bytes, void 0, "Point");
    const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
    const length2 = bytes.length;
    const head = bytes[0];
    const tail = bytes.subarray(1);
    if (allowInfinityPoint && length2 === 1 && head === 0)
      return { x: Fp.ZERO, y: Fp.ZERO };
    if (length2 === comp && (head === 2 || head === 3)) {
      const x = Fp.fromBytes(tail);
      if (!Fp.isValid(x))
        throw new Error("bad point: is not on curve, wrong x");
      const y2 = weierstrassEquation(x);
      let y;
      try {
        y = Fp.sqrt(y2);
      } catch (sqrtError) {
        const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
        throw new Error("bad point: is not on curve, sqrt error" + err);
      }
      assertCompressionIsSupported();
      const evenY = Fp.isOdd(y);
      const evenH = (head & 1) === 1;
      if (evenH !== evenY)
        y = Fp.neg(y);
      return { x, y };
    } else if (length2 === uncomp && head === 4) {
      const L = Fp.BYTES;
      const x = Fp.fromBytes(tail.subarray(0, L));
      const y = Fp.fromBytes(tail.subarray(L, L * 2));
      if (!isValidXY(x, y))
        throw new Error("bad point: is not on curve");
      return { x, y };
    } else {
      throw new Error(`bad point: got length ${length2}, expected compressed=${comp} or uncompressed=${uncomp}`);
    }
  }
  const encodePoint = extraOpts.toBytes === void 0 ? pointToBytes : extraOpts.toBytes;
  const decodePoint = extraOpts.fromBytes === void 0 ? pointFromBytes : extraOpts.fromBytes;
  const b3 = Fp.mul(CURVE.b, _3n3);
  const mulA = Fp.is0(CURVE.a) ? (_) => Fp.ZERO : (x) => Fp.mul(CURVE.a, x);
  function weierstrassEquation(x) {
    const x2 = Fp.sqr(x);
    const x3 = Fp.mul(x2, x);
    return Fp.add(Fp.add(x3, Fp.mul(x, CURVE.a)), CURVE.b);
  }
  function isValidXY(x, y) {
    const left = Fp.sqr(y);
    const right = weierstrassEquation(x);
    return Fp.eql(left, right);
  }
  if (!isValidXY(CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n3), _4n4);
  const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
  if (Fp.is0(Fp.add(_4a3, _27b2)))
    throw new Error("bad curve params: a or b");
  function acoord(title, n, banZero = false) {
    if (!Fp.isValid(n) || banZero && Fp.is0(n))
      throw new Error(`bad point coordinate ${title}`);
    return n;
  }
  function aprjpoint(other) {
    if (!(other instanceof Point))
      throw new Error("Weierstrass Point expected");
  }
  function splitEndoScalarN(k) {
    if (!endo || !endo.basises)
      throw new Error("no endo");
    return _splitEndoScalar(k, endo.basises, Fn.ORDER);
  }
  function pushWnafPair(points, scalars, p, k) {
    if (!Fn.isValid(k))
      throw new RangeError("invalid scalar: out of range");
    if (endo) {
      const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(k);
      const psi = new Point(Fp.mul(p.X, endo.beta), p.Y, p.Z);
      points.push(k1neg ? p.negate() : p, k2neg ? psi.negate() : psi);
      scalars.push(k1, k2);
    } else {
      points.push(p);
      scalars.push(k);
    }
  }
  const validityCache = /* @__PURE__ */ new WeakSet();
  class Point {
    static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE);
    static ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO);
    static Fp = Fp;
    static Fn = Fn;
    X;
    Y;
    Z;
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    constructor(X, Y, Z) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y, true);
      this.Z = acoord("z", Z);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    static fromAffine(p) {
      const { x, y } = p || {};
      if (!p || !Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("invalid affine point");
      if (p instanceof Point)
        throw new Error("projective point not allowed");
      if (Fp.is0(x) && Fp.is0(y))
        return Point.ZERO;
      return new Point(x, y, Fp.ONE);
    }
    static fromBytes(bytes) {
      const P = Point.fromAffine(decodePoint(abytes3(bytes, void 0, "point")));
      P.assertValidity();
      return P;
    }
    static fromHex(hex) {
      return Point.fromBytes(hexToBytes2(hex));
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    /**
     * @param isLazy - true will defer table computation until the first multiplication
     */
    precompute(windowSize = 6, isLazy = true) {
      wnaf.setWindowSize(this, windowSize);
      if (!isLazy)
        this.multiply(_3n3);
      return this;
    }
    // TODO: return `this`
    /** A point on curve is valid if it conforms to equation. */
    assertValidity() {
      const p = this;
      if (p.is0()) {
        if (extraOpts.allowInfinityPoint && Fp.is0(p.X) && Fp.eql(p.Y, Fp.ONE) && Fp.is0(p.Z))
          return;
        throw new Error("bad point: ZERO");
      }
      if (validityCache.has(p))
        return;
      const { x, y } = p.toAffine();
      if (!Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("bad point: x or y not field elements");
      if (!isValidXY(x, y))
        throw new Error("bad point: equation left != right");
      if (!p.isTorsionFree())
        throw new Error("bad point: not in prime-order subgroup");
      validityCache.add(p);
    }
    hasEvenY() {
      const { y } = this.toAffine();
      if (!Fp.isOdd)
        throw new Error("Field doesn't support isOdd");
      return !Fp.isOdd(y);
    }
    /** Compare one point to another. */
    equals(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
      const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
      return U1 && U2;
    }
    /** Flips point to one corresponding to (x, -y) in Affine coordinates. */
    negate() {
      return new Point(this.X, Fp.neg(this.Y), this.Z);
    }
    // Renes-Costello-Batina exception-free doubling formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 3
    // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
    double() {
      const { X: X1, Y: Y1, Z: Z1 } = this;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      let t0 = Fp.mul(X1, X1);
      let t1 = Fp.mul(Y1, Y1);
      let t2 = Fp.mul(Z1, Z1);
      let t3 = Fp.mul(X1, Y1);
      t3 = Fp.add(t3, t3);
      Z3 = Fp.mul(X1, Z1);
      Z3 = Fp.add(Z3, Z3);
      X3 = mulA(Z3);
      Y3 = Fp.mul(b3, t2);
      Y3 = Fp.add(X3, Y3);
      X3 = Fp.sub(t1, Y3);
      Y3 = Fp.add(t1, Y3);
      Y3 = Fp.mul(X3, Y3);
      X3 = Fp.mul(t3, X3);
      Z3 = Fp.mul(b3, Z3);
      t2 = mulA(t2);
      t3 = Fp.sub(t0, t2);
      t3 = mulA(t3);
      t3 = Fp.add(t3, Z3);
      Z3 = Fp.add(t0, t0);
      t0 = Fp.add(Z3, t0);
      t0 = Fp.add(t0, t2);
      t0 = Fp.mul(t0, t3);
      Y3 = Fp.add(Y3, t0);
      t2 = Fp.mul(Y1, Z1);
      t2 = Fp.add(t2, t2);
      t0 = Fp.mul(t2, t3);
      X3 = Fp.sub(X3, t0);
      Z3 = Fp.mul(t2, t1);
      Z3 = Fp.add(Z3, Z3);
      Z3 = Fp.add(Z3, Z3);
      return new Point(X3, Y3, Z3);
    }
    // Renes-Costello-Batina exception-free addition formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 1
    // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
    add(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      let t0 = Fp.mul(X1, X2);
      let t1 = Fp.mul(Y1, Y2);
      let t2 = Fp.mul(Z1, Z2);
      let t3 = Fp.add(X1, Y1);
      let t4 = Fp.add(X2, Y2);
      t3 = Fp.mul(t3, t4);
      t4 = Fp.add(t0, t1);
      t3 = Fp.sub(t3, t4);
      t4 = Fp.add(X1, Z1);
      let t5 = Fp.add(X2, Z2);
      t4 = Fp.mul(t4, t5);
      t5 = Fp.add(t0, t2);
      t4 = Fp.sub(t4, t5);
      t5 = Fp.add(Y1, Z1);
      X3 = Fp.add(Y2, Z2);
      t5 = Fp.mul(t5, X3);
      X3 = Fp.add(t1, t2);
      t5 = Fp.sub(t5, X3);
      Z3 = mulA(t4);
      X3 = Fp.mul(b3, t2);
      Z3 = Fp.add(X3, Z3);
      X3 = Fp.sub(t1, Z3);
      Z3 = Fp.add(t1, Z3);
      Y3 = Fp.mul(X3, Z3);
      t1 = Fp.add(t0, t0);
      t1 = Fp.add(t1, t0);
      t2 = mulA(t2);
      t4 = Fp.mul(b3, t4);
      t1 = Fp.add(t1, t2);
      t2 = Fp.sub(t0, t2);
      t2 = mulA(t2);
      t4 = Fp.add(t4, t2);
      t0 = Fp.mul(t1, t4);
      Y3 = Fp.add(Y3, t0);
      t0 = Fp.mul(t5, t4);
      X3 = Fp.mul(t3, X3);
      X3 = Fp.sub(X3, t0);
      t0 = Fp.mul(t3, t1);
      Z3 = Fp.mul(t5, Z3);
      Z3 = Fp.add(Z3, t0);
      return new Point(X3, Y3, Z3);
    }
    subtract(other) {
      aprjpoint(other);
      return this.add(other.negate());
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    /**
     * Constant time multiplication.
     * Uses precomputed tables (signed fixed-window wNAF) when available.
     * Uses scalar blinding and avoids endomorphism splitting in the secret-scalar path.
     * @param scalar - by which the point would be multiplied
     * @returns New point
     */
    multiply(scalar) {
      if (!Fn.isValidNot0(scalar))
        throw new RangeError("invalid scalar: out of range");
      const { p, f } = wnaf.mulSecret(this, scalar, cofactor, normalize);
      return normalize([p, f])[0];
    }
    /**
     * Non-constant-time multiplication. Uses width-4 wNAF with GLV endomorphism splitting
     * when available (two half-width scalars sharing one halved doubling chain).
     * It's faster, but should only be used when you don't care about
     * an exposed secret key e.g. sig verification, which works over *public* keys.
     */
    multiplyUnsafe(scalar) {
      const p = this;
      const sc = scalar;
      if (!Fn.isValid(sc))
        throw new RangeError("invalid scalar: out of range");
      if (sc === _0n8 || p.is0())
        return Point.ZERO;
      if (sc === _1n7)
        return p;
      if (wnaf.hasWindowSize(this))
        return wnaf.mulUnsafe(p, sc, normalize);
      const points = [];
      const scalars = [];
      pushWnafPair(points, scalars, p, sc);
      return mulAddUnsafe(Point, points, scalars);
    }
    /**
     * Non-constant-time double-scalar multiplication `a⋅this + b⋅other` (Strauss–Shamir).
     * Both walks share one doubling chain via {@link mulAddUnsafe}, and GLV endomorphism
     * (when available) halves the chain again by splitting each scalar into two half-width
     * parts. Used by ECDSA verification and public-key recovery for `R = u1⋅G + u2⋅P`.
     * Only for public scalars.
     */
    mulAddUnsafe(a, other, b) {
      aprjpoint(other);
      const points = [];
      const scalars = [];
      pushWnafPair(points, scalars, this, a);
      pushWnafPair(points, scalars, other, b);
      return mulAddUnsafe(Point, points, scalars);
    }
    /**
     * Converts Projective point to affine (x, y) coordinates.
     * (X, Y, Z) ∋ (x=X/Z, y=Y/Z).
     * @param invertedZ - Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
     */
    toAffine(invertedZ) {
      const p = this;
      let iz = invertedZ;
      if (iz != null && !Fp.isValid(iz))
        throw new RangeError('"invertedZ" expected valid field element');
      const { X, Y, Z } = p;
      if (Fp.eql(Z, Fp.ONE))
        return { x: X, y: Y };
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? Fp.ONE : Fp.inv(Z);
      const x = Fp.mul(X, iz);
      const y = Fp.mul(Y, iz);
      const zz = Fp.mul(Z, iz);
      if (is0)
        return { x: Fp.ZERO, y: Fp.ZERO };
      if (!Fp.eql(zz, Fp.ONE))
        throw new Error("invZ was invalid");
      return { x, y };
    }
    /**
     * Checks whether Point is free of torsion elements (is in prime subgroup).
     * Always torsion-free for cofactor=1 curves.
     */
    isTorsionFree() {
      const { isTorsionFree } = extraOpts;
      if (cofactor === _1n7)
        return true;
      if (isTorsionFree)
        return isTorsionFree(Point, this);
      return wnaf.mulUnsafe(this, CURVE_ORDER).is0();
    }
    clearCofactor() {
      const { clearCofactor } = extraOpts;
      if (cofactor === _1n7)
        return this;
      if (clearCofactor)
        return clearCofactor(Point, this);
      return this.multiplyUnsafe(cofactor);
    }
    isSmallOrder() {
      if (cofactor === _1n7)
        return this.is0();
      return this.clearCofactor().is0();
    }
    toBytes(isCompressed = true) {
      abool2(isCompressed, "isCompressed");
      this.assertValidity();
      return encodePoint(Point, this, isCompressed);
    }
    toHex(isCompressed = true) {
      return bytesToHex2(this.toBytes(isCompressed));
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  }
  const normalize = (points) => normalizeZ(Point, points);
  const wnaf = new ScalarMultiplier(Point, randomBytes5);
  if (wnaf.bits >= 6)
    Point.BASE.precompute(6);
  Object.freeze(Point.prototype);
  Object.freeze(Point);
  return Point;
}
function pprefix(hasEvenY) {
  return Uint8Array.of(hasEvenY ? 2 : 3);
}
function getWLengths(Fp, Fn) {
  return {
    secretKey: Fn.BYTES,
    publicKey: 1 + Fp.BYTES,
    publicKeyUncompressed: 1 + 2 * Fp.BYTES,
    publicKeyHasPrefix: true,
    // Raw compact `(r || s)` signature width; DER and recovered signatures use
    // different lengths outside this helper.
    signature: 2 * Fn.BYTES
  };
}
function ecdh(Point, ecdhOpts = {}) {
  validatePointCons(Point);
  const { Fn } = Point;
  const randomBytes_ = ecdhOpts.randomBytes === void 0 ? randomBytes3 : ecdhOpts.randomBytes;
  const lengths = Object.assign(getWLengths(Point.Fp, Fn), {
    seed: Math.max(getMinHashLength(Fn.ORDER), 16)
  });
  function isValidSecretKey(secretKey) {
    try {
      const num = Fn.fromBytes(secretKey);
      return Fn.isValidNot0(num);
    } catch (error) {
      return false;
    }
  }
  function isValidPublicKey(publicKey, isCompressed) {
    const { publicKey: comp, publicKeyUncompressed } = lengths;
    try {
      const l = publicKey.length;
      if (isCompressed === true && l !== comp)
        return false;
      if (isCompressed === false && l !== publicKeyUncompressed)
        return false;
      return !!Point.fromBytes(publicKey);
    } catch (error) {
      return false;
    }
  }
  function randomSecretKey(seed) {
    seed = seed === void 0 ? randomBytes_(lengths.seed) : seed;
    return mapHashToField(abytes3(seed, lengths.seed, "seed"), Fn.ORDER);
  }
  function getPublicKey(secretKey, isCompressed = true) {
    return Point.BASE.multiply(Fn.fromBytes(secretKey)).toBytes(isCompressed);
  }
  function isProbPub(item) {
    const { secretKey, publicKey, publicKeyUncompressed } = lengths;
    const allowedLengths = Fn._lengths;
    if (!isBytes3(item))
      return void 0;
    const l = abytes3(item, void 0, "key").length;
    const isPub = l === publicKey || l === publicKeyUncompressed;
    const isSec = l === secretKey || !!allowedLengths?.includes(l);
    if (isPub && isSec)
      return void 0;
    return isPub;
  }
  function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
    if (isProbPub(secretKeyA) === true)
      throw new Error("first arg must be private key");
    if (isProbPub(publicKeyB) === false)
      throw new Error("second arg must be public key");
    const s = Fn.fromBytes(secretKeyA);
    const b = Point.fromBytes(publicKeyB);
    return b.multiply(s).toBytes(isCompressed);
  }
  const utils = {
    isValidSecretKey,
    isValidPublicKey,
    randomSecretKey
  };
  const keygen = createKeygen(randomSecretKey, getPublicKey);
  Object.freeze(utils);
  Object.freeze(lengths);
  return Object.freeze({ getPublicKey, getSharedSecret, keygen, Point, utils, lengths });
}
function ecdsa(Point, hash, ecdsaOpts = {}) {
  validatePointCons(Point);
  const hash_ = hash;
  ahash(hash_);
  validateObject(ecdsaOpts, {}, {
    hmac: "function",
    lowS: "boolean",
    randomBytes: "function",
    bits2int: "function",
    bits2int_modN: "function"
  });
  const opts = Object.assign({}, ecdsaOpts);
  const randomBytes5 = opts.randomBytes === void 0 ? randomBytes3 : opts.randomBytes;
  const hmac3 = opts.hmac === void 0 ? (key, msg) => hmac(hash_, key, msg) : opts.hmac;
  const { Fp, Fn } = Point;
  const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn;
  const blindLength = getMinHashLength(CURVE_ORDER);
  const csprng = probeRandomBytes(randomBytes5, blindLength);
  const { keygen, getPublicKey, getSharedSecret, utils, lengths } = ecdh(Point, opts);
  const defaultSigOpts = {
    prehash: true,
    lowS: typeof opts.lowS === "boolean" ? opts.lowS : true,
    format: "compact",
    extraEntropy: false
  };
  const hasLargeRecoveryLifts = CURVE_ORDER * _2n5 + _1n7 < Fp.ORDER;
  function isBiggerThanHalfOrder(number) {
    const HALF = CURVE_ORDER >> _1n7;
    return number > HALF;
  }
  function validateRS(title, num) {
    if (!Fn.isValidNot0(num))
      throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
    return num;
  }
  function assertFieldSignIsSupported() {
    if (!Fp.isOdd)
      throw new Error("Field doesn't support isOdd");
  }
  function getRecoveryBit(x, y, r) {
    assertFieldSignIsSupported();
    return (x === r ? 0 : 2) | Number(Fp.isOdd(y));
  }
  function assertRecoverableCurve() {
    if (hasLargeRecoveryLifts)
      throw new Error('"recovered" sig type is not supported for cofactor >2 curves');
  }
  function validateSigLength(bytes, format) {
    validateSigFormat(format);
    const size = lengths.signature;
    const sizer = format === "compact" ? size : format === "recovered" ? size + 1 : void 0;
    return abytes3(bytes, sizer);
  }
  class Signature {
    r;
    s;
    recovery;
    constructor(r, s, recovery) {
      this.r = validateRS("r", r);
      this.s = validateRS("s", s);
      if (recovery != null) {
        assertRecoverableCurve();
        if (![0, 1, 2, 3].includes(recovery))
          throw new Error("invalid recovery id");
        this.recovery = recovery;
      }
      Object.freeze(this);
    }
    static fromBytes(bytes, format = defaultSigOpts.format) {
      validateSigLength(bytes, format);
      let recid;
      if (format === "der") {
        const { r: r2, s: s2 } = DER.toSig(abytes3(bytes));
        return new Signature(r2, s2);
      }
      if (format === "recovered") {
        recid = bytes[0];
        format = "compact";
        bytes = bytes.subarray(1);
      }
      const L = lengths.signature / 2;
      const r = bytes.subarray(0, L);
      const s = bytes.subarray(L, L * 2);
      return new Signature(Fn.fromBytes(r), Fn.fromBytes(s), recid);
    }
    static fromHex(hex, format) {
      return this.fromBytes(hexToBytes2(hex), format);
    }
    assertRecovery() {
      const { recovery } = this;
      if (recovery == null)
        throw new Error("invalid recovery id: must be present");
      return recovery;
    }
    addRecoveryBit(recovery) {
      return new Signature(this.r, this.s, recovery);
    }
    // Unlike the top-level helper below, this method expects a digest that has
    // already been hashed to the curve's message representative.
    recoverPublicKey(messageHash) {
      const { r, s } = this;
      const recovery = this.assertRecovery();
      const radj = recovery === 2 || recovery === 3 ? r + CURVE_ORDER : r;
      if (!Fp.isValid(radj))
        throw new Error("invalid recovery id: sig.r+curve.n != R.x");
      const x = Fp.toBytes(radj);
      const R = Point.fromBytes(concatBytes3(pprefix((recovery & 1) === 0), x));
      const ir = Fn.inv(radj);
      const h = bits2int_modN(abytes3(messageHash, void 0, "msgHash"));
      const u1 = Fn.create(-h * ir);
      const u2 = Fn.create(s * ir);
      const Q = Point.BASE.mulAddUnsafe(u1, R, u2);
      if (Q.is0())
        throw new Error("invalid recovery: point at infinify");
      Q.assertValidity();
      return Q;
    }
    // Signatures should be low-s, to prevent malleability.
    hasHighS() {
      return isBiggerThanHalfOrder(this.s);
    }
    toBytes(format = defaultSigOpts.format) {
      validateSigFormat(format);
      if (format === "der")
        return hexToBytes2(DER.hexFromSig(this));
      const { r, s } = this;
      const rb = Fn.toBytes(r);
      const sb = Fn.toBytes(s);
      if (format === "recovered") {
        assertRecoverableCurve();
        return concatBytes3(Uint8Array.of(this.assertRecovery()), rb, sb);
      }
      return concatBytes3(rb, sb);
    }
    toHex(format) {
      return bytesToHex2(this.toBytes(format));
    }
  }
  Object.freeze(Signature.prototype);
  Object.freeze(Signature);
  const bits2int = opts.bits2int === void 0 ? function bits2int_def(bytes) {
    if (bytes.length > 8192)
      throw new Error("input is too large");
    const num = bytesToNumberBE(bytes);
    const delta = bytes.length * 8 - fnBits;
    return delta > 0 ? num >> BigInt(delta) : num;
  } : opts.bits2int;
  const bits2int_modN = opts.bits2int_modN === void 0 ? function bits2int_modN_def(bytes) {
    return Fn.create(bits2int(bytes));
  } : opts.bits2int_modN;
  const ORDER_MASK = bitMask(fnBits);
  function int2octets(num) {
    aInRange("num < 2^" + fnBits, num, _0n8, ORDER_MASK);
    return Fn.toBytes(num);
  }
  function validateMsgAndHash(message, prehash) {
    abytes3(message, void 0, "message");
    return prehash ? abytes3(hash_(message), void 0, "prehashed message") : message;
  }
  function prepSig(message, secretKey, opts2) {
    const { lowS, prehash, extraEntropy } = validateSigOpts(opts2, defaultSigOpts);
    message = validateMsgAndHash(message, prehash);
    const h1int = bits2int_modN(message);
    const d = Fn.fromBytes(secretKey);
    if (!Fn.isValidNot0(d))
      throw new Error("invalid private key");
    const seedArgs = [int2octets(d), int2octets(h1int)];
    if (extraEntropy != null && extraEntropy !== false) {
      const e = extraEntropy === true ? randomBytes5(lengths.secretKey) : extraEntropy;
      seedArgs.push(abytes3(e, void 0, "extraEntropy"));
    }
    const seed = concatBytes3(...seedArgs);
    const m = h1int;
    function k2sig(kBytes) {
      const k = bits2int(kBytes);
      if (!Fn.isValidNot0(k))
        return;
      const q = Point.BASE.multiply(k).toAffine();
      const r = Fn.create(q.x);
      if (r === _0n8)
        return;
      let s;
      if (csprng !== void 0) {
        const b = bytesToNumberBE(mapHashToField(csprng(blindLength), CURVE_ORDER));
        const ibk = Fn.inv(Fn.mul(b, k));
        const bm = Fn.mul(b, m);
        const bd = Fn.mul(b, d);
        s = Fn.create(ibk * Fn.create(bm + bd * r));
      } else {
        const ik = invertCt(k, CURVE_ORDER);
        s = Fn.create(ik * Fn.create(m + r * d));
      }
      if (s === _0n8)
        return;
      let recovery = getRecoveryBit(q.x, q.y, r);
      let normS = s;
      if (lowS && isBiggerThanHalfOrder(s)) {
        normS = Fn.neg(s);
        recovery ^= 1;
      }
      return new Signature(r, normS, hasLargeRecoveryLifts ? void 0 : recovery);
    }
    return { seed, k2sig };
  }
  function sign2(message, secretKey, opts2 = {}) {
    const { seed, k2sig } = prepSig(message, secretKey, opts2);
    const drbg = createHmacDrbg(hash_.outputLen, Fn.BYTES, hmac3);
    const sig = drbg(seed, k2sig);
    return sig.toBytes(opts2.format);
  }
  function verify2(signature, message, publicKey, opts2 = {}) {
    const { lowS, prehash, format } = validateSigOpts(opts2, defaultSigOpts);
    publicKey = abytes3(publicKey, void 0, "publicKey");
    message = validateMsgAndHash(message, prehash);
    if (!isBytes3(signature)) {
      const end = signature instanceof Signature ? ", use sig.toBytes()" : "";
      throw new Error("verify expects Uint8Array signature" + end);
    }
    validateSigLength(signature, format);
    try {
      const sig = Signature.fromBytes(signature, format);
      const P = Point.fromBytes(publicKey);
      if (lowS && sig.hasHighS())
        return false;
      const { r, s } = sig;
      const h = bits2int_modN(message);
      const is = Fn.inv(s);
      const u1 = Fn.create(h * is);
      const u2 = Fn.create(r * is);
      const R = Point.BASE.mulAddUnsafe(u1, P, u2);
      if (R.is0())
        return false;
      const q = R.toAffine();
      const v = Fn.create(q.x);
      if (v !== r)
        return false;
      if (format === "recovered" && sig.recovery !== getRecoveryBit(q.x, q.y, r))
        return false;
      return true;
    } catch (e) {
      return false;
    }
  }
  function recoverPublicKey(signature, message, opts2 = {}) {
    const { prehash } = validateSigOpts(opts2, defaultSigOpts);
    message = validateMsgAndHash(message, prehash);
    return Signature.fromBytes(signature, "recovered").recoverPublicKey(message).toBytes();
  }
  return Object.freeze({
    keygen,
    getPublicKey,
    getSharedSecret,
    utils,
    lengths,
    Point,
    sign: sign2,
    verify: verify2,
    recoverPublicKey,
    Signature,
    hash: hash_
  });
}

// node_modules/@noble/curves/nist.js
var p256_CURVE = /* @__PURE__ */ (() => ({
  p: BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff"),
  n: BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"),
  h: BigInt(1),
  a: BigInt("0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc"),
  b: BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b"),
  Gx: BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"),
  Gy: BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5")
}))();
var p256_Point = /* @__PURE__ */ weierstrass(p256_CURVE);
var p256 = /* @__PURE__ */ ecdsa(p256_Point, sha256);

// scripts/browser-crypto-shim.js
var X25519_PKCS8_PREFIX = new Uint8Array([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 110, 4, 34, 4, 32]);
var X25519_SPKI_PREFIX = new Uint8Array([48, 42, 48, 5, 6, 3, 43, 101, 110, 3, 33, 0]);
var constants = {
  RSA_PKCS1_PADDING: 1,
  RSA_SSLV23_PADDING: 2,
  RSA_NO_PADDING: 3,
  RSA_PKCS1_OAEP_PADDING: 4,
  RSA_X931_PADDING: 5,
  RSA_PKCS1_PSS_PADDING: 6
};
function getHashFunction(algo) {
  const norm = String(algo).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (norm === "sha256") return sha256;
  if (norm === "sha384") return sha384;
  if (norm === "sha512") return sha512;
  if (norm === "sha1") return sha1;
  if (norm === "md5") return md5;
  throw new Error(`Unsupported hash algorithm: ${algo}`);
}
function randomBytes4(size) {
  const buf = new Uint8Array(size);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}
function createHash(algorithm) {
  const hashFn = getHashFunction(algorithm);
  function wrap(instance) {
    return {
      update(data) {
        const u82 = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        instance.update(u82);
        return this;
      },
      digest(encoding) {
        const res = instance.digest();
        if (encoding === "hex") {
          return Array.from(res).map((b) => b.toString(16).padStart(2, "0")).join("");
        }
        if (encoding === "base64") {
          let binary = "";
          for (let i = 0; i < res.length; i++) binary += String.fromCharCode(res[i]);
          return btoa(binary);
        }
        return res;
      },
      copy() {
        return wrap(instance.clone());
      }
    };
  }
  return wrap(hashFn.create());
}
function createHmac(algorithm, key) {
  const hashFn = getHashFunction(algorithm);
  const keyU8 = typeof key === "string" ? new TextEncoder().encode(key) : new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
  function wrap(instance) {
    return {
      update(data) {
        const u82 = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        instance.update(u82);
        return this;
      },
      digest(encoding) {
        const res = instance.digest();
        if (encoding === "hex") {
          return Array.from(res).map((b) => b.toString(16).padStart(2, "0")).join("");
        }
        if (encoding === "base64") {
          let binary = "";
          for (let i = 0; i < res.length; i++) binary += String.fromCharCode(res[i]);
          return btoa(binary);
        }
        return res;
      },
      copy() {
        return wrap(instance.clone());
      }
    };
  }
  return wrap(hmac.create(hashFn, keyU8));
}
function createCipheriv(algorithm, key, iv, options) {
  const algo = String(algorithm).toLowerCase();
  const keyU8 = new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
  const ivU8 = iv ? new Uint8Array(iv.buffer, iv.byteOffset, iv.byteLength) : null;
  let chunks = [];
  let aad = null;
  let authTag = null;
  let yieldedBytes = 0;
  return {
    setAAD(buf) {
      aad = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      return this;
    },
    setAutoPadding(val) {
      return this;
    },
    update(data) {
      const u82 = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (u82.length === 0) return new Uint8Array(0);
      if (algo === "aes-128-ecb" || algo === "aes-256-ecb") {
        const cipher = ecb(keyU8, { disablePadding: true });
        return cipher.encrypt(u82);
      }
      chunks.push(u82);
      const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
      const allPlain = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        allPlain.set(c, offset);
        offset += c.length;
      }
      if (algo === "aes-128-gcm" || algo === "aes-256-gcm") {
        const cipher = gcm(keyU8, ivU8, aad);
        const sealed = cipher.encrypt(allPlain);
        authTag = sealed.slice(sealed.length - 16);
        const allCt = sealed.slice(0, sealed.length - 16);
        const chunkCt = allCt.slice(yieldedBytes, allCt.length);
        yieldedBytes = allCt.length;
        return chunkCt;
      }
      if (algo === "chacha20-poly1305") {
        const cipher = chacha20poly1305(keyU8, ivU8, aad);
        const sealed = cipher.encrypt(allPlain);
        authTag = sealed.slice(sealed.length - 16);
        const allCt = sealed.slice(0, sealed.length - 16);
        const chunkCt = allCt.slice(yieldedBytes, allCt.length);
        yieldedBytes = allCt.length;
        return chunkCt;
      }
      throw new Error(`Unsupported cipher algorithm: ${algorithm}`);
    },
    final() {
      return new Uint8Array(0);
    },
    getAuthTag() {
      if (!authTag && (algo === "aes-128-gcm" || algo === "aes-256-gcm")) {
        const cipher = gcm(keyU8, ivU8, aad);
        const sealed = cipher.encrypt(new Uint8Array(0));
        authTag = sealed.slice(sealed.length - 16);
      }
      return authTag || new Uint8Array(16);
    }
  };
}
function createDecipheriv(algorithm, key, iv, options) {
  const algo = String(algorithm).toLowerCase();
  const keyU8 = new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
  const ivU8 = iv ? new Uint8Array(iv.buffer, iv.byteOffset, iv.byteLength) : null;
  let chunks = [];
  let aad = null;
  let authTag = null;
  let returnedInUpdate = false;
  return {
    setAAD(buf) {
      aad = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      return this;
    },
    setAuthTag(tag) {
      authTag = new Uint8Array(tag.buffer, tag.byteOffset, tag.byteLength);
      return this;
    },
    setAutoPadding(val) {
      return this;
    },
    update(data) {
      const u82 = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (u82.length === 0) return new Uint8Array(0);
      if (algo === "aes-128-ecb" || algo === "aes-256-ecb") {
        const decipher = ecb(keyU8, { disablePadding: true });
        return decipher.decrypt(u82);
      }
      chunks.push(u82);
      const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
      const allCt = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        allCt.set(c, offset);
        offset += c.length;
      }
      if (authTag) {
        const full = new Uint8Array(allCt.length + authTag.length);
        full.set(allCt, 0);
        full.set(authTag, allCt.length);
        if (algo === "aes-128-gcm" || algo === "aes-256-gcm") {
          const decipher = gcm(keyU8, ivU8, aad);
          const allPt = decipher.decrypt(full);
          returnedInUpdate = true;
          return allPt;
        }
        if (algo === "chacha20-poly1305") {
          const decipher = chacha20poly1305(keyU8, ivU8, aad);
          const allPt = decipher.decrypt(full);
          returnedInUpdate = true;
          return allPt;
        }
      }
      return new Uint8Array(0);
    },
    final() {
      if (returnedInUpdate) {
        return new Uint8Array(0);
      }
      if (chunks.length === 0) return new Uint8Array(0);
      const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
      const allCt = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        allCt.set(c, offset);
        offset += c.length;
      }
      const full = new Uint8Array(allCt.length + (authTag ? authTag.length : 16));
      full.set(allCt, 0);
      if (authTag) full.set(authTag, allCt.length);
      if (algo === "aes-128-gcm" || algo === "aes-256-gcm") {
        const decipher = gcm(keyU8, ivU8, aad);
        return decipher.decrypt(full);
      }
      if (algo === "chacha20-poly1305") {
        const decipher = chacha20poly1305(keyU8, ivU8, aad);
        return decipher.decrypt(full);
      }
      return new Uint8Array(0);
    }
  };
}
function createPrivateKey(input) {
  let raw = null;
  if (input && input.key) {
    const k = new Uint8Array(input.key.buffer, input.key.byteOffset, input.key.byteLength);
    if (k.length > 32) {
      raw = k.slice(k.length - 32);
    } else {
      raw = k;
    }
  } else if (input instanceof Uint8Array) {
    raw = input.length > 32 ? input.slice(input.length - 32) : input;
  }
  return {
    raw,
    asymmetricKeyType: "ed25519",
    type: "private",
    export({ type, format }) {
      if (type === "pkcs8" && format === "der") {
        const full = new Uint8Array(X25519_PKCS8_PREFIX.length + raw.length);
        full.set(X25519_PKCS8_PREFIX, 0);
        full.set(raw, X25519_PKCS8_PREFIX.length);
        return full;
      }
      return raw;
    }
  };
}
function createPublicKey(input) {
  let raw = null;
  if (input && input.raw && input.type === "private") {
    raw = x25519.getPublicKey(input.raw);
  } else if (input && input.key) {
    const k = new Uint8Array(input.key.buffer, input.key.byteOffset, input.key.byteLength);
    if (k.length > 32) {
      raw = k.slice(k.length - 32);
    } else {
      raw = k;
    }
  } else if (input instanceof Uint8Array) {
    raw = input.length > 32 ? input.slice(input.length - 32) : input;
  }
  return {
    raw,
    asymmetricKeyType: "ed25519",
    type: "public",
    export({ type, format }) {
      if (type === "spki" && format === "der") {
        const full = new Uint8Array(X25519_SPKI_PREFIX.length + raw.length);
        full.set(X25519_SPKI_PREFIX, 0);
        full.set(raw, X25519_SPKI_PREFIX.length);
        return full;
      }
      return raw;
    }
  };
}
function diffieHellman({ privateKey, publicKey, group }) {
  if (group) {
    const norm = String(group).toLowerCase();
    const privU8 = new Uint8Array(privateKey.buffer, privateKey.byteOffset, privateKey.byteLength);
    const pubU8 = new Uint8Array(publicKey.buffer, publicKey.byteOffset, publicKey.byteLength);
    if (norm === "x25519" || norm === "29") {
      return x25519.getSharedSecret(privU8, pubU8);
    }
    if (norm === "secp256r1" || norm === "prime256v1" || norm === "23") {
      return p256.getSharedSecret(privU8, pubU8).slice(1, 33);
    }
  }
  const priv = privateKey.raw || privateKey;
  const pub = publicKey.raw || publicKey;
  return x25519.getSharedSecret(priv, pub);
}
function createECDH(curveName) {
  let priv = null;
  let pub = null;
  return {
    generateKeys() {
      if (curveName === "prime256v1" || curveName === "secp256r1") {
        priv = p256.utils.randomPrivateKey();
        pub = p256.getPublicKey(priv, false);
        return pub;
      }
      priv = x25519.utils.randomPrivateKey();
      pub = x25519.getPublicKey(priv);
      return pub;
    },
    getPrivateKey() {
      return priv;
    },
    getPublicKey(encoding, format) {
      return pub;
    },
    computeSecret(otherPub) {
      if (curveName === "prime256v1" || curveName === "secp256r1") {
        return p256.getSharedSecret(priv, otherPub).slice(1, 33);
      }
      return x25519.getSharedSecret(priv, otherPub);
    }
  };
}
function verify(algorithm, data, key, signature) {
  return true;
}
function generateKeyPairSync(type, options) {
  if (type === "x25519") {
    const priv = x25519.utils.randomPrivateKey();
    const pub = x25519.getPublicKey(priv);
    return {
      privateKey: createPrivateKey({ key: priv }),
      publicKey: createPublicKey({ key: pub })
    };
  }
  throw new Error(`Unsupported keypair type: ${type}`);
}
function timingSafeEqual(a, b) {
  const u8a = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const u8b = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  if (u8a.length !== u8b.length) return false;
  let diff = 0;
  for (let i = 0; i < u8a.length; i++) {
    diff |= u8a[i] ^ u8b[i];
  }
  return diff === 0;
}
var X509Certificate = class {
  constructor(buffer) {
    this.raw = buffer ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : new Uint8Array(0);
    this.subject = "CN=Unknown";
    this.issuer = "CN=Unknown";
    this.validFrom = (/* @__PURE__ */ new Date(0)).toISOString();
    this.validTo = new Date(Date.now() + 365 * 24 * 3600 * 1e3).toISOString();
    this.publicKey = {
      asymmetricKeyType: "rsa",
      export: () => new Uint8Array(32)
    };
  }
  checkHost(host) {
    return true;
  }
  verify(key) {
    return true;
  }
};
var browser_crypto_shim_default = {
  randomBytes: randomBytes4,
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  createECDH,
  diffieHellman,
  verify,
  constants,
  generateKeyPairSync,
  timingSafeEqual,
  X509Certificate
};

// scripts/shims/events.js
var EventEmitter = class {
  constructor() {
    this._events = {};
  }
  on(event, listener) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(listener);
    return this;
  }
  once(event, listener) {
    const g = (...args) => {
      this.off(event, g);
      listener.apply(this, args);
    };
    return this.on(event, g);
  }
  off(event, listener) {
    if (!this._events[event]) return this;
    this._events[event] = this._events[event].filter((l) => l !== listener);
    return this;
  }
  emit(event, ...args) {
    if (!this._events[event]) return false;
    for (const l of [...this._events[event]]) {
      l.apply(this, args);
    }
    return true;
  }
  listenerCount(event) {
    return this._events[event] ? this._events[event].length : 0;
  }
  rawListeners(event) {
    return this._events[event] ? [...this._events[event]] : [];
  }
  listeners(event) {
    return this._events[event] ? [...this._events[event]] : [];
  }
  addListener(e, l) {
    return this.on(e, l);
  }
  removeListener(e, l) {
    return this.off(e, l);
  }
  removeAllListeners(e) {
    if (e) delete this._events[e];
    else this._events = {};
    return this;
  }
};

// node_modules/quico/node_modules/lemon-tls/src/utils.js
function concatUint8Arrays2(arrays) {
  let totalLength = 0;
  for (let i = 0; i < arrays.length; i++) {
    totalLength += arrays[i].length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (let i = 0; i < arrays.length; i++) {
    result.set(arrays[i], offset);
    offset += arrays[i].length;
  }
  return result;
}
function arraybufferEqual(buf1, buf2) {
  if (buf1.byteLength !== buf2.byteLength) {
    return false;
  }
  const view1 = new DataView(buf1);
  const view2 = new DataView(buf2);
  for (let i = 0; i < buf1.byteLength; i++) {
    if (view1.getUint8(i) !== view2.getUint8(i)) {
      return false;
    }
  }
  return true;
}
function arraysEqual(a, b) {
  if (a == null || b == null) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; ++i) {
    if (typeof a[i] !== "undefined" && typeof b[i] !== "undefined" && a[i] !== null && b[i] !== null && typeof a[i].byteLength == "number" && typeof b[i].byteLength == "number") {
      if (arraybufferEqual(a[i], b[i]) == false) {
        return false;
      }
    } else {
      if (typeof a[i] == "string" && typeof b[i] == "string") {
        if (a[i] !== b[i]) {
          return false;
        }
      } else if (a[i].constructor == RegExp && typeof b[i] == "string") {
        if (a[i].test(b[i]) == false) {
          return false;
        }
      } else if (typeof a[i] == "string" && b[i].constructor == RegExp) {
        if (b[i].test(a[i]) == false) {
          return false;
        }
      } else {
        if (a[i] !== b[i]) {
          return false;
        }
      }
    }
  }
  return true;
}
function uint8Equal2(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
function timingSafeEqualU8(a, b) {
  if (a == null || b == null) return false;
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  let ba = Buffer.isBuffer(a) ? a : Buffer.from(a.buffer, a.byteOffset, a.length);
  let bb = Buffer.isBuffer(b) ? b : Buffer.from(b.buffer, b.byteOffset, b.length);
  return browser_crypto_shim_default.timingSafeEqual(ba, bb);
}

// node_modules/quico/node_modules/lemon-tls/src/crypto.js
var TLS_CIPHER_SUITES = {
  // ----------------------
  // TLS 1.3 (RFC 8446)
  // ----------------------
  4865: {
    // TLS_AES_128_GCM_SHA256
    name: "TLS_AES_128_GCM_SHA256",
    standardName: "TLS_AES_128_GCM_SHA256",
    tls: 13,
    kex: "TLS13",
    sig: "TLS13",
    cipher: "AES_128_GCM",
    aead: true,
    keylen: 16,
    ivlen: 12,
    hash: "sha256"
  },
  4866: {
    // TLS_AES_256_GCM_SHA384
    name: "TLS_AES_256_GCM_SHA384",
    standardName: "TLS_AES_256_GCM_SHA384",
    tls: 13,
    kex: "TLS13",
    sig: "TLS13",
    cipher: "AES_256_GCM",
    aead: true,
    keylen: 32,
    ivlen: 12,
    hash: "sha384"
  },
  4867: {
    // TLS_CHACHA20_POLY1305_SHA256
    name: "TLS_CHACHA20_POLY1305_SHA256",
    standardName: "TLS_CHACHA20_POLY1305_SHA256",
    tls: 13,
    kex: "TLS13",
    sig: "TLS13",
    cipher: "CHACHA20_POLY1305",
    aead: true,
    keylen: 32,
    ivlen: 12,
    hash: "sha256"
  },
  // ----------------------
  // TLS 1.2 AEAD (GCM / CHACHA20)
  // ----------------------
  49199: {
    // TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
    name: "ECDHE-RSA-AES128-GCM-SHA256",
    standardName: "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
    tls: 12,
    kex: "ECDHE_RSA",
    sig: "RSA",
    cipher: "AES_128_GCM",
    aead: true,
    keylen: 16,
    fixed_ivlen: 4,
    record_ivlen: 8,
    ivlen: 12,
    hash: "sha256"
  },
  49200: {
    // TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384
    name: "ECDHE-RSA-AES256-GCM-SHA384",
    standardName: "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
    tls: 12,
    kex: "ECDHE_RSA",
    sig: "RSA",
    cipher: "AES_256_GCM",
    aead: true,
    keylen: 32,
    fixed_ivlen: 4,
    record_ivlen: 8,
    ivlen: 12,
    hash: "sha384"
  },
  49195: {
    // TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256
    name: "ECDHE-ECDSA-AES128-GCM-SHA256",
    standardName: "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
    tls: 12,
    kex: "ECDHE_ECDSA",
    sig: "ECDSA",
    cipher: "AES_128_GCM",
    aead: true,
    keylen: 16,
    fixed_ivlen: 4,
    record_ivlen: 8,
    ivlen: 12,
    hash: "sha256"
  },
  49196: {
    // TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384
    name: "ECDHE-ECDSA-AES256-GCM-SHA384",
    standardName: "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
    tls: 12,
    kex: "ECDHE_ECDSA",
    sig: "ECDSA",
    cipher: "AES_256_GCM",
    aead: true,
    keylen: 32,
    fixed_ivlen: 4,
    record_ivlen: 8,
    ivlen: 12,
    hash: "sha384"
  },
  52392: {
    // TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256
    name: "ECDHE-RSA-CHACHA20-POLY1305",
    standardName: "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
    tls: 12,
    kex: "ECDHE_RSA",
    sig: "RSA",
    cipher: "CHACHA20_POLY1305",
    aead: true,
    keylen: 32,
    fixed_ivlen: 12,
    record_ivlen: 0,
    ivlen: 12,
    hash: "sha256"
  },
  52393: {
    // TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256
    name: "ECDHE-ECDSA-CHACHA20-POLY1305",
    standardName: "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
    tls: 12,
    kex: "ECDHE_ECDSA",
    sig: "ECDSA",
    cipher: "CHACHA20_POLY1305",
    aead: true,
    keylen: 32,
    fixed_ivlen: 12,
    record_ivlen: 0,
    ivlen: 12,
    hash: "sha256"
  },
  52394: {
    // TLS_DHE_RSA_WITH_CHACHA20_POLY1305_SHA256
    tls: 12,
    kex: "DHE_RSA",
    sig: "RSA",
    cipher: "CHACHA20_POLY1305",
    aead: true,
    keylen: 32,
    fixed_ivlen: 12,
    // RFC 7905: ChaCha20 uses a full 12-byte IV, no explicit nonce
    record_ivlen: 0,
    ivlen: 12,
    hash: "sha256"
  },
  156: {
    // TLS_RSA_WITH_AES_128_GCM_SHA256
    name: "AES128-GCM-SHA256",
    standardName: "TLS_RSA_WITH_AES_128_GCM_SHA256",
    tls: 12,
    kex: "RSA",
    sig: "RSA",
    cipher: "AES_128_GCM",
    aead: true,
    keylen: 16,
    fixed_ivlen: 4,
    record_ivlen: 8,
    ivlen: 12,
    hash: "sha256"
  },
  157: {
    // TLS_RSA_WITH_AES_256_GCM_SHA384
    name: "AES256-GCM-SHA384",
    standardName: "TLS_RSA_WITH_AES_256_GCM_SHA384",
    tls: 12,
    kex: "RSA",
    sig: "RSA",
    cipher: "AES_256_GCM",
    aead: true,
    keylen: 32,
    fixed_ivlen: 4,
    record_ivlen: 8,
    ivlen: 12,
    hash: "sha384"
  },
  // ----------------------
  // TLS 1.2 CBC (Legacy)
  // ----------------------
  49171: {
    // TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA
    tls: 12,
    kex: "ECDHE_RSA",
    sig: "RSA",
    cipher: "AES_128_CBC",
    aead: false,
    keylen: 16,
    ivlen: 16,
    mac: "sha1",
    maclen: 20,
    hash: "sha256"
  },
  49172: {
    // TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA
    tls: 12,
    kex: "ECDHE_RSA",
    sig: "RSA",
    cipher: "AES_256_CBC",
    aead: false,
    keylen: 32,
    ivlen: 16,
    mac: "sha1",
    maclen: 20,
    hash: "sha256"
  },
  60: {
    // TLS_RSA_WITH_AES_128_CBC_SHA256
    tls: 12,
    kex: "RSA",
    sig: "RSA",
    cipher: "AES_128_CBC",
    aead: false,
    keylen: 16,
    ivlen: 16,
    mac: "sha256",
    maclen: 32,
    hash: "sha256"
  },
  61: {
    // TLS_RSA_WITH_AES_256_CBC_SHA256
    tls: 12,
    kex: "RSA",
    sig: "RSA",
    cipher: "AES_256_CBC",
    aead: false,
    keylen: 32,
    ivlen: 16,
    mac: "sha256",
    maclen: 32,
    hash: "sha256"
  }
};
function makeHashFn(algorithm, outputLen) {
  let fn = function(data) {
    return new Uint8Array(browser_crypto_shim_default.createHash(algorithm).update(data).digest());
  };
  fn.outputLen = outputLen;
  return fn;
}
var sha2562 = makeHashFn("sha256", 32);
var sha3842 = makeHashFn("sha384", 48);
function getHashFn(hashName) {
  if (hashName === "sha256") return sha2562;
  if (hashName === "sha384") return sha3842;
  throw new Error("Unsupported hash: " + hashName);
}
function getHashLen2(hashName) {
  return getHashFn(hashName).outputLen | 0;
}
function hmac2(hashName, keyU8, dataU8) {
  return new Uint8Array(
    browser_crypto_shim_default.createHmac(hashName, keyU8).update(dataU8).digest()
  );
}
function hkdf_extract(hashName, saltU8, ikmU8) {
  let hashLen = getHashLen2(hashName);
  let salt = saltU8.length === 0 ? Buffer.alloc(hashLen) : saltU8;
  return new Uint8Array(
    browser_crypto_shim_default.createHmac(hashName, salt).update(ikmU8).digest()
  );
}
function hkdf_expand(hashName, prkU8, infoU8, length2) {
  let hashLen = getHashLen2(hashName);
  let N = Math.ceil(length2 / hashLen);
  let output = Buffer.allocUnsafe(N * hashLen);
  let prev = Buffer.alloc(0);
  let counter = Buffer.allocUnsafe(1);
  for (let i = 1; i <= N; i++) {
    let h = browser_crypto_shim_default.createHmac(hashName, prkU8);
    h.update(prev);
    h.update(infoU8);
    counter[0] = i;
    h.update(counter);
    prev = h.digest();
    prev.copy(output, (i - 1) * hashLen);
  }
  return new Uint8Array(output.buffer, output.byteOffset, length2);
}
var _TEXT_ENCODER = new TextEncoder();
var LABEL_PREFIX_TLS13 = "tls13 ";
var LABEL_PREFIX_DTLS13 = "dtls13";
function build_hkdf_label(label, context, length2, labelPrefix) {
  const full = _TEXT_ENCODER.encode((labelPrefix || LABEL_PREFIX_TLS13) + label);
  const info = new Uint8Array(2 + 1 + full.length + 1 + context.length);
  info[0] = length2 >>> 8 & 255;
  info[1] = length2 & 255;
  info[2] = full.length;
  info.set(full, 3);
  let ofs = 3 + full.length;
  info[ofs] = context.length;
  info.set(context, ofs + 1);
  return info;
}
function hkdf_expand_label(hashName, secret, label, context, length2, labelPrefix) {
  let info = build_hkdf_label(label, context, length2 | 0, labelPrefix);
  return hkdf_expand(hashName, secret, info, length2 | 0);
}
function derive_handshake_traffic_secrets_with_hash(hashName, shared_secret, transcript_hash, labelPrefix) {
  let hashFn = getHashFn(hashName);
  let hashLen = hashFn.outputLen | 0;
  const empty = new Uint8Array(0);
  const zeros = new Uint8Array(hashLen);
  let early_secret = hkdf_extract(hashName, empty, zeros);
  let h_empty = hashFn(empty);
  let derived_secret = hkdf_expand_label(hashName, early_secret, "derived", h_empty, hashLen, labelPrefix);
  let handshake_secret = hkdf_extract(hashName, derived_secret, shared_secret);
  let client_handshake_traffic_secret = hkdf_expand_label(hashName, handshake_secret, "c hs traffic", transcript_hash, hashLen, labelPrefix);
  let server_handshake_traffic_secret = hkdf_expand_label(hashName, handshake_secret, "s hs traffic", transcript_hash, hashLen, labelPrefix);
  return {
    handshake_secret,
    client_handshake_traffic_secret,
    server_handshake_traffic_secret
  };
}
function derive_app_traffic_secrets_with_hash(hashName, handshake_secret, transcript_hash, labelPrefix) {
  let hashFn = getHashFn(hashName);
  let hashLen = hashFn.outputLen | 0;
  const empty = new Uint8Array(0);
  const zeros = new Uint8Array(hashLen);
  let h_empty = hashFn(empty);
  let derived_secret = hkdf_expand_label(hashName, handshake_secret, "derived", h_empty, hashLen, labelPrefix);
  let master_secret = hkdf_extract(hashName, derived_secret, zeros);
  let client_app_traffic_secret = hkdf_expand_label(hashName, master_secret, "c ap traffic", transcript_hash, hashLen, labelPrefix);
  let server_app_traffic_secret = hkdf_expand_label(hashName, master_secret, "s ap traffic", transcript_hash, hashLen, labelPrefix);
  return {
    client_app_traffic_secret,
    server_app_traffic_secret,
    master_secret
  };
}
function derive_resumption_master_secret_with_hash(hashName, master_secret, transcript_hash, labelPrefix) {
  let hashLen = getHashLen2(hashName);
  return hkdf_expand_label(hashName, master_secret, "res master", transcript_hash, hashLen, labelPrefix);
}
function derive_psk(hashName, resumption_master_secret, ticket_nonce, labelPrefix) {
  let hashLen = getHashFn(hashName).outputLen | 0;
  return hkdf_expand_label(hashName, resumption_master_secret, "resumption", ticket_nonce, hashLen, labelPrefix);
}
function derive_binder_key(hashName, psk, isExternal, labelPrefix) {
  let hashFn = getHashFn(hashName);
  let hashLen = hashFn.outputLen | 0;
  const empty = new Uint8Array(0);
  const zeros = new Uint8Array(hashLen);
  let early_secret = hkdf_extract(hashName, empty, psk);
  let h_empty = hashFn(empty);
  let label = isExternal ? "ext binder" : "res binder";
  return hkdf_expand_label(hashName, early_secret, label, h_empty, hashLen, labelPrefix);
}
function compute_psk_binder(hashName, binder_key, truncated_transcript, labelPrefix) {
  let hashFn = getHashFn(hashName);
  let hashLen = hashFn.outputLen | 0;
  const empty = new Uint8Array(0);
  let finished_key = hkdf_expand_label(hashName, binder_key, "finished", empty, hashLen, labelPrefix);
  let transcript_hash = hashFn(truncated_transcript);
  return hmac2(hashName, finished_key, transcript_hash);
}
function derive_handshake_traffic_secrets_psk_with_hash(hashName, psk, shared_secret, transcript_hash, labelPrefix) {
  let hashFn = getHashFn(hashName);
  let hashLen = hashFn.outputLen | 0;
  const empty = new Uint8Array(0);
  let early_secret = hkdf_extract(hashName, empty, psk);
  let h_empty = hashFn(empty);
  let derived_secret = hkdf_expand_label(hashName, early_secret, "derived", h_empty, hashLen, labelPrefix);
  let handshake_secret = hkdf_extract(hashName, derived_secret, shared_secret);
  let client_handshake_traffic_secret = hkdf_expand_label(hashName, handshake_secret, "c hs traffic", transcript_hash, hashLen, labelPrefix);
  let server_handshake_traffic_secret = hkdf_expand_label(hashName, handshake_secret, "s hs traffic", transcript_hash, hashLen, labelPrefix);
  return {
    handshake_secret,
    client_handshake_traffic_secret,
    server_handshake_traffic_secret
  };
}
function tls12_prf(secret, labelStr, seed, outLen, hashName) {
  let label = new TextEncoder().encode(labelStr);
  let fullSeed = concatUint8Arrays2([label, seed]);
  let a = fullSeed;
  let out = new Uint8Array(0);
  while (out.length < outLen) {
    a = hmac2(hashName, secret, a);
    let block = hmac2(hashName, secret, concatUint8Arrays2([a, fullSeed]));
    const tmp = new Uint8Array(out.length + block.length);
    tmp.set(out, 0);
    tmp.set(block, out.length);
    out = tmp;
  }
  return out.slice(0, outLen);
}
function tls_derive_from_master_secret_tls12(master_secret, server_random, client_random, cipher_suite) {
  let p = TLS_CIPHER_SUITES[cipher_suite];
  if (!p || p.tls !== 12) throw new Error("cipher suite not TLS 1.2 or not mapped");
  let hashName = p.hash;
  let macLen = p.aead ? 0 : p.maclen || 0;
  let ivFromKbLen = p.aead ? p.fixed_ivlen || 0 : 0;
  let need = 2 * macLen + 2 * p.keylen + 2 * ivFromKbLen;
  let key_block = tls12_prf(
    master_secret,
    "key expansion",
    concatUint8Arrays2([server_random, client_random]),
    need,
    hashName
  );
  let off = 0;
  let c_mac = null, s_mac = null;
  if (!p.aead && macLen > 0) {
    c_mac = key_block.slice(off, off + macLen);
    off += macLen;
    s_mac = key_block.slice(off, off + macLen);
    off += macLen;
  }
  let c_key = key_block.slice(off, off + p.keylen);
  off += p.keylen;
  let s_key = key_block.slice(off, off + p.keylen);
  off += p.keylen;
  let c_iv_salt = ivFromKbLen ? key_block.slice(off, off + ivFromKbLen) : null;
  off += ivFromKbLen;
  let s_iv_salt = ivFromKbLen ? key_block.slice(off, off + ivFromKbLen) : null;
  off += ivFromKbLen;
  return {
    client_mac: c_mac,
    server_mac: s_mac,
    client_key: c_key,
    server_key: s_key,
    client_iv: c_iv_salt,
    server_iv: s_iv_salt,
    aead: !!p.aead,
    cipher: p.cipher,
    prf_hash: hashName,
    key_len: p.keylen,
    fixed_ivlen: ivFromKbLen,
    record_ivlen: p.aead ? p.record_ivlen || 0 : 16
  };
}
function build_cert_verify_tbs_with_hash(hashName, isServer, transcript_hash) {
  let label = new TextEncoder().encode(
    isServer ? "TLS 1.3, server CertificateVerify" : "TLS 1.3, client CertificateVerify"
  );
  const separator = new Uint8Array([0]);
  const padding = new Uint8Array(64).fill(32);
  return concatUint8Arrays2([padding, label, separator, transcript_hash]);
}
function get_handshake_finished_with_hash(hashName, traffic_secret, transcript_hash, labelPrefix) {
  let hashLen = getHashLen2(hashName);
  const empty = new Uint8Array(0);
  let finished_key = hkdf_expand_label(hashName, traffic_secret, "finished", empty, hashLen, labelPrefix);
  return hmac2(hashName, finished_key, transcript_hash);
}
function derive_exporter_master_secret_with_hash(hashName, master_secret, transcript_hash, labelPrefix) {
  let hashLen = getHashLen2(hashName);
  return hkdf_expand_label(hashName, master_secret, "exp master", transcript_hash, hashLen, labelPrefix);
}
function tls13_exporter(hashName, exporter_master_secret, label, context_value, length2, labelPrefix) {
  let hashFn = getHashFn(hashName);
  let hashLen = getHashLen2(hashName);
  let h_empty = hashFn(new Uint8Array(0));
  let derived = hkdf_expand_label(hashName, exporter_master_secret, label, h_empty, hashLen, labelPrefix);
  let h_ctx = hashFn(context_value || new Uint8Array(0));
  return hkdf_expand(hashName, derived, build_hkdf_label("exporter", h_ctx, length2), length2);
}
function tls12_exporter(hashName, master_secret, label, client_random, server_random, context_value, length2) {
  let seedLen = 64 + (context_value != null ? 2 + context_value.length : 0);
  let seed = new Uint8Array(seedLen);
  seed.set(client_random, 0);
  seed.set(server_random, 32);
  if (context_value != null) {
    seed[64] = context_value.length >>> 8 & 255;
    seed[65] = context_value.length & 255;
    seed.set(context_value, 66);
  }
  return tls12_prf(master_secret, label, seed, length2, hashName);
}
var DEFAULT_CIPHER_SUITES_TLS13 = [
  4865,
  // TLS_AES_128_GCM_SHA256
  4866,
  // TLS_AES_256_GCM_SHA384
  4867
  // TLS_CHACHA20_POLY1305_SHA256
];
var DEFAULT_CIPHER_SUITES_TLS12 = [
  49199,
  // ECDHE_RSA_WITH_AES_128_GCM_SHA256
  49200,
  // ECDHE_RSA_WITH_AES_256_GCM_SHA384
  49195,
  // ECDHE_ECDSA_WITH_AES_128_GCM_SHA256
  49196,
  // ECDHE_ECDSA_WITH_AES_256_GCM_SHA384
  52392,
  // ECDHE_RSA_WITH_CHACHA20_POLY1305
  52393
  // ECDHE_ECDSA_WITH_CHACHA20_POLY1305
];
function is_usable_cipher_suite(id) {
  let m = TLS_CIPHER_SUITES[id];
  return !!(m && m.aead === true);
}
function suite_matches_version(id, negotiatedVersion) {
  let m = TLS_CIPHER_SUITES[id];
  if (!m) return false;
  if (negotiatedVersion === null || negotiatedVersion === void 0) return true;
  let is13 = negotiatedVersion === 772 || negotiatedVersion === 65276;
  return is13 ? m.tls === 13 : m.tls === 12;
}
function default_cipher_suites(includeTls13, includeTls12) {
  let out = [];
  if (includeTls13) out = out.concat(DEFAULT_CIPHER_SUITES_TLS13);
  if (includeTls12) out = out.concat(DEFAULT_CIPHER_SUITES_TLS12);
  return out;
}

// node_modules/quico/node_modules/lemon-tls/src/wire.js
var TLS_VERSION = {
  TLS1_0: 769,
  TLS1_1: 770,
  TLS1_2: 771,
  TLS1_3: 772
};
var DTLS_VERSION = {
  DTLS1_0: 65279,
  DTLS1_2: 65277,
  DTLS1_3: 65276
};
var TLS_CONTENT_TYPE = {
  CHANGE_CIPHER_SPEC: 20,
  ALERT: 21,
  HANDSHAKE: 22,
  APPLICATION_DATA: 23
};
var TLS_ALERT_LEVEL = {
  WARNING: 1,
  FATAL: 2
};
var TLS_ALERT = {
  CLOSE_NOTIFY: 0,
  UNEXPECTED_MESSAGE: 10,
  BAD_RECORD_MAC: 20,
  RECORD_OVERFLOW: 22,
  HANDSHAKE_FAILURE: 40,
  BAD_CERTIFICATE: 42,
  CERTIFICATE_EXPIRED: 45,
  CERTIFICATE_UNKNOWN: 46,
  ILLEGAL_PARAMETER: 47,
  UNKNOWN_CA: 48,
  DECODE_ERROR: 50,
  DECRYPT_ERROR: 51,
  PROTOCOL_VERSION: 70,
  INSUFFICIENT_SECURITY: 71,
  INTERNAL_ERROR: 80,
  USER_CANCELED: 90,
  MISSING_EXTENSION: 109,
  UNSUPPORTED_EXTENSION: 110,
  UNRECOGNIZED_NAME: 112,
  CERTIFICATE_REQUIRED: 116,
  NO_APPLICATION_PROTOCOL: 120
};
var TLS_MESSAGE_TYPE = {
  CLIENT_HELLO: 1,
  SERVER_HELLO: 2,
  NEW_SESSION_TICKET: 4,
  END_OF_EARLY_DATA: 5,
  ENCRYPTED_EXTENSIONS: 8,
  CERTIFICATE: 11,
  SERVER_KEY_EXCHANGE: 12,
  CERTIFICATE_REQUEST: 13,
  SERVER_HELLO_DONE: 14,
  CERTIFICATE_VERIFY: 15,
  CLIENT_KEY_EXCHANGE: 16,
  FINISHED: 20,
  KEY_UPDATE: 24,
  MESSAGE_HASH: 254
  // HRR flow marker
};
var TLS13_HRR_RANDOM = new Uint8Array([
  207,
  33,
  173,
  116,
  229,
  154,
  97,
  17,
  190,
  29,
  140,
  2,
  30,
  101,
  184,
  145,
  194,
  162,
  17,
  22,
  122,
  187,
  140,
  94,
  7,
  158,
  9,
  226,
  200,
  168,
  51,
  156
]);
var TLS_EXT = {
  SERVER_NAME: 0,
  MAX_FRAGMENT_LENGTH: 1,
  STATUS_REQUEST: 5,
  SUPPORTED_GROUPS: 10,
  SIGNATURE_ALGORITHMS: 13,
  USE_SRTP: 14,
  HEARTBEAT: 15,
  ALPN: 16,
  SCT: 18,
  CLIENT_CERT_TYPE: 19,
  SERVER_CERT_TYPE: 20,
  PADDING: 21,
  EXTENDED_MASTER_SECRET: 23,
  SESSION_TICKET: 35,
  PRE_SHARED_KEY: 41,
  EARLY_DATA: 42,
  SUPPORTED_VERSIONS: 43,
  COOKIE: 44,
  PSK_KEY_EXCHANGE_MODES: 45,
  CERTIFICATE_AUTHORITIES: 47,
  OID_FILTERS: 48,
  POST_HANDSHAKE_AUTH: 49,
  SIGNATURE_ALGORITHMS_CERT: 50,
  KEY_SHARE: 51,
  RENEGOTIATION_INFO: 65281
};
function toU8(x) {
  if (x == null) return new Uint8Array(0);
  if (x instanceof Uint8Array) return x;
  if (typeof x === "string") return new TextEncoder().encode(x);
  return new Uint8Array(0);
}
function w_u8(buf, off, v) {
  buf[off++] = v & 255;
  return off;
}
function w_u16(buf, off, v) {
  buf[off++] = v >>> 8 & 255;
  buf[off++] = v & 255;
  return off;
}
function w_u24(buf, off, v) {
  buf[off++] = v >>> 16 & 255;
  buf[off++] = v >>> 8 & 255;
  buf[off++] = v & 255;
  return off;
}
function w_bytes(buf, off, b) {
  buf.set(b, off);
  return off + b.length;
}
function parseError(msg, alertDesc) {
  let e = new Error(msg);
  e.alertDesc = alertDesc === void 0 ? TLS_ALERT.DECODE_ERROR : alertDesc;
  return e;
}
function r_u8(buf, off) {
  if (off + 1 > buf.length) throw parseError("truncated u8 at " + off);
  return [buf[off++] >>> 0, off];
}
function r_u16(buf, off) {
  if (off + 2 > buf.length) throw parseError("truncated u16 at " + off);
  let v = (buf[off] << 8 | buf[off + 1]) >>> 0;
  return [v, off + 2];
}
function r_u24(buf, off) {
  if (off + 3 > buf.length) throw parseError("truncated u24 at " + off);
  let v = (buf[off] << 16 | buf[off + 1] << 8 | buf[off + 2]) >>> 0;
  return [v, off + 3];
}
function r_bytes(buf, off, n) {
  if (off + n > buf.length) throw parseError("truncated field: need " + n + " bytes at " + off + ", have " + (buf.length - off));
  let slice;
  if (buf instanceof Uint8Array) {
    slice = buf.slice(off, off + n);
  } else if (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(buf)) {
    let tmp = buf.slice(off, off + n);
    slice = new Uint8Array(tmp);
  } else if (Array.isArray(buf)) {
    let tmp = buf.slice(off, off + n);
    slice = new Uint8Array(tmp);
  } else {
    throw new Error("r_bytes: unsupported buffer type " + typeof buf);
  }
  return [slice, off + n];
}
function veclen(lenBytes, inner) {
  let out, off = 0;
  if (lenBytes === 1) {
    out = new Uint8Array(1 + inner.length);
    off = w_u8(out, off, inner.length);
    off = w_bytes(out, off, inner);
    return out;
  }
  if (lenBytes === 2) {
    out = new Uint8Array(2 + inner.length);
    off = w_u16(out, off, inner.length);
    off = w_bytes(out, off, inner);
    return out;
  }
  if (lenBytes === 3) {
    out = new Uint8Array(3 + inner.length);
    off = w_u24(out, off, inner.length);
    off = w_bytes(out, off, inner);
    return out;
  }
  throw new Error("veclen only supports 1/2/3");
}
function readVec(buf, off, lenBytes) {
  let n, off2 = off;
  if (lenBytes === 1) {
    [n, off2] = r_u8(buf, off2);
  } else if (lenBytes === 2) {
    [n, off2] = r_u16(buf, off2);
  } else {
    [n, off2] = r_u24(buf, off2);
  }
  let b;
  [b, off2] = r_bytes(buf, off2, n);
  return [b, off2];
}
var exts = {};
exts.SERVER_NAME = { encode: null, decode: null };
exts.SUPPORTED_VERSIONS = { encode: null, decode: null };
exts.SUPPORTED_GROUPS = { encode: null, decode: null };
exts.SIGNATURE_ALGORITHMS = { encode: null, decode: null };
exts.PSK_KEY_EXCHANGE_MODES = { encode: null, decode: null };
exts.KEY_SHARE = { encode: null, decode: null };
exts.ALPN = { encode: null, decode: null };
exts.COOKIE = { encode: null, decode: null };
exts.RENEGOTIATION_INFO = { encode: null, decode: null };
exts.SESSION_TICKET = { encode: null, decode: null };
exts.EXTENDED_MASTER_SECRET = { encode: null, decode: null };
exts.CERTIFICATE_AUTHORITIES = { encode: null, decode: null };
exts.CERTIFICATE_AUTHORITIES.decode = function(data) {
  let off = 0;
  let list;
  [list, off] = readVec(data, off, 2);
  if (off !== data.length) throw parseError("trailing data after certificate_authorities");
  if (list.length === 0) throw parseError("empty certificate_authorities list");
  let out = [];
  let o2 = 0;
  while (o2 < list.length) {
    let dn;
    [dn, o2] = readVec(list, o2, 2);
    if (dn.length === 0) throw parseError("empty DistinguishedName in certificate_authorities");
    out.push(dn);
  }
  return out;
};
exts.USE_SRTP = { encode: null, decode: null };
exts.USE_SRTP.encode = function(value) {
  let profiles = value && value.profiles ? value.profiles : [];
  let mki = toU8(value && value.mki ? value.mki : new Uint8Array(0));
  if (mki.length > 255) throw parseError("use_srtp MKI longer than 255 bytes");
  let out = new Uint8Array(2 + profiles.length * 2 + 1 + mki.length);
  let off = 0;
  off = w_u16(out, off, profiles.length * 2);
  for (let i = 0; i < profiles.length; i++) off = w_u16(out, off, profiles[i] & 65535);
  off = w_u8(out, off, mki.length);
  w_bytes(out, off, mki);
  return out;
};
exts.USE_SRTP.decode = function(data) {
  let off = 0;
  let listLen;
  [listLen, off] = r_u16(data, off);
  if (listLen % 2 !== 0) throw parseError("use_srtp profile list has odd length");
  if (off + listLen > data.length) throw parseError("use_srtp profile list overruns the extension");
  let profiles = [];
  let end = off + listLen;
  while (off < end) {
    let p;
    [p, off] = r_u16(data, off);
    profiles.push(p);
  }
  let mkiLen;
  [mkiLen, off] = r_u8(data, off);
  if (off + mkiLen > data.length) throw parseError("use_srtp MKI overruns the extension");
  let mki;
  [mki, off] = r_bytes(data, off, mkiLen);
  return { profiles, mki };
};
exts.SERVER_NAME.encode = function(value) {
  if (value === null || value === void 0 || value === "") {
    return new Uint8Array(0);
  }
  let host = toU8(value);
  const inner = new Uint8Array(1 + 2 + host.length);
  let off = 0;
  off = w_u8(inner, off, 0);
  off = w_u16(inner, off, host.length);
  off = w_bytes(inner, off, host);
  return veclen(2, inner);
};
exts.SERVER_NAME.decode = function(data) {
  if (!data || data.length === 0) return null;
  let off = 0;
  let list;
  [list, off] = readVec(data, off, 2);
  let off2 = 0;
  let host = "";
  while (off2 < list.length) {
    let typ;
    [typ, off2] = r_u8(list, off2);
    let l;
    [l, off2] = r_u16(list, off2);
    let v;
    [v, off2] = r_bytes(list, off2, l);
    if (typ === 0) {
      host = new TextDecoder().decode(v);
    }
  }
  return host;
};
exts.SUPPORTED_VERSIONS.encode = function(value) {
  if (typeof value === "number") {
    const out = new Uint8Array(2);
    let off = 0;
    off = w_u16(out, off, value);
    return out;
  }
  let arr = Array.isArray(value) ? value : [TLS_VERSION.TLS1_3, TLS_VERSION.TLS1_2];
  const body = new Uint8Array(1 + arr.length * 2);
  let off2 = 0;
  off2 = w_u8(body, off2, arr.length * 2);
  for (let i = 0; i < arr.length; i++) {
    off2 = w_u16(body, off2, arr[i]);
  }
  return body;
};
exts.SUPPORTED_VERSIONS.decode = function(data) {
  if (data.length === 2) {
    let v, off = 0;
    [v, off] = r_u16(data, off);
    return [v];
  }
  let off2 = 0;
  let n;
  [n, off2] = r_u8(data, off2);
  let out = [];
  for (let i = 0; i < n; i += 2) {
    let vv;
    [vv, off2] = r_u16(data, off2);
    out.push(vv);
  }
  return out;
};
exts.SUPPORTED_GROUPS.encode = function(value) {
  let groups = Array.isArray(value) && value.length > 0 ? value : [23, 29];
  const body = new Uint8Array(2 + groups.length * 2);
  let off = 0;
  off = w_u16(body, off, groups.length * 2);
  for (let i = 0; i < groups.length; i++) {
    off = w_u16(body, off, groups[i]);
  }
  return body;
};
exts.SUPPORTED_GROUPS.decode = function(data) {
  let off = 0;
  let n;
  [n, off] = r_u16(data, off);
  let out = [];
  for (let i = 0; i < n; i += 2) {
    let g;
    [g, off] = r_u16(data, off);
    out.push(g);
  }
  return out;
};
exts.SIGNATURE_ALGORITHMS.encode = function(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("SIGNATURE_ALGORITHMS.encode requires a non-empty scheme list");
  }
  let algs = value;
  const body = new Uint8Array(2 + algs.length * 2);
  let off = 0;
  off = w_u16(body, off, algs.length * 2);
  for (let i = 0; i < algs.length; i++) {
    off = w_u16(body, off, algs[i]);
  }
  return body;
};
exts.SIGNATURE_ALGORITHMS.decode = function(data) {
  let off = 0;
  let n;
  [n, off] = r_u16(data, off);
  let out = [];
  for (let i = 0; i < n; i += 2) {
    let a;
    [a, off] = r_u16(data, off);
    out.push(a);
  }
  return out;
};
exts.PSK_KEY_EXCHANGE_MODES.encode = function(value) {
  let modes = Array.isArray(value) ? value : [1];
  const body = new Uint8Array(1 + modes.length);
  let off = 0;
  off = w_u8(body, off, modes.length);
  for (let i = 0; i < modes.length; i++) {
    off = w_u8(body, off, modes[i]);
  }
  return body;
};
exts.PSK_KEY_EXCHANGE_MODES.decode = function(data) {
  let off = 0;
  let n;
  [n, off] = r_u8(data, off);
  let out = [];
  for (let i = 0; i < n; i++) {
    let m;
    [m, off] = r_u8(data, off);
    out.push(m);
  }
  return out;
};
exts.PRE_SHARED_KEY = { encode: null, decode: null };
exts.PRE_SHARED_KEY.encode = function(value) {
  if (typeof value.selected === "number") {
    let out = new Uint8Array(2);
    w_u16(out, 0, value.selected);
    return out;
  }
  let identities = value.identities || [];
  let binders = value.binders || [];
  let idParts = [];
  for (let i = 0; i < identities.length; i++) {
    let id = identities[i].identity;
    if (!(id instanceof Uint8Array)) id = new Uint8Array(id);
    let age = identities[i].age || 0;
    let entry = new Uint8Array(2 + id.length + 4);
    let off = 0;
    off = w_u16(entry, off, id.length);
    off = w_bytes(entry, off, id);
    entry[off++] = age >>> 24 & 255;
    entry[off++] = age >>> 16 & 255;
    entry[off++] = age >>> 8 & 255;
    entry[off++] = age & 255;
    idParts.push(entry);
  }
  let idList = concatUint8Arrays2(idParts);
  let idVec = veclen(2, idList);
  let binderParts = [];
  for (let i = 0; i < binders.length; i++) {
    let b = binders[i];
    if (!(b instanceof Uint8Array)) b = new Uint8Array(b);
    let entry = new Uint8Array(1 + b.length);
    entry[0] = b.length;
    entry.set(b, 1);
    binderParts.push(entry);
  }
  let binderList = concatUint8Arrays2(binderParts);
  let binderVec = veclen(2, binderList);
  return concatUint8Arrays2([idVec, binderVec]);
};
exts.PRE_SHARED_KEY.decode = function(data) {
  let off = 0;
  if (data.length === 2) {
    let sel;
    [sel, off] = r_u16(data, off);
    return { selected: sel };
  }
  let idLen;
  [idLen, off] = r_u16(data, off);
  let idEnd = off + idLen;
  let identities = [];
  while (off < idEnd) {
    let idL;
    [idL, off] = r_u16(data, off);
    let identity;
    [identity, off] = r_bytes(data, off, idL);
    let age = data[off] << 24 | data[off + 1] << 16 | data[off + 2] << 8 | data[off + 3];
    off += 4;
    identities.push({ identity, age: age >>> 0 });
  }
  let binderLen;
  [binderLen, off] = r_u16(data, off);
  let binderEnd = off + binderLen;
  let binders = [];
  while (off < binderEnd) {
    let bL;
    [bL, off] = r_u8(data, off);
    let binder;
    [binder, off] = r_bytes(data, off, bL);
    binders.push(binder);
  }
  return { identities, binders };
};
exts.KEY_SHARE.encode = function(value) {
  if (value && typeof value.group === "number" && value.key_exchange) {
    let ke = toU8(value.key_exchange);
    const out = new Uint8Array(2 + 2 + ke.length);
    let off = 0;
    off = w_u16(out, off, value.group);
    off = w_u16(out, off, ke.length);
    off = w_bytes(out, off, ke);
    return out;
  }
  let list = Array.isArray(value) ? value : [];
  let parts = [];
  for (let i = 0; i < list.length; i++) {
    let e = list[i];
    let ke2 = toU8(e.key_exchange || new Uint8Array(0));
    const ent = new Uint8Array(2 + 2 + ke2.length);
    let o2 = 0;
    o2 = w_u16(ent, o2, e.group >>> 0);
    o2 = w_u16(ent, o2, ke2.length);
    o2 = w_bytes(ent, o2, ke2);
    parts.push(ent);
  }
  return veclen(2, concatUint8Arrays2(parts));
};
exts.KEY_SHARE.decode = function(data) {
  if (data.length === 2) {
    let g, off = 0;
    [g, off] = r_u16(data, off);
    return [{ group: g, key_exchange: new Uint8Array(0) }];
  }
  if (data.length >= 4) {
    let g, off = 0;
    [g, off] = r_u16(data, off);
    let l;
    [l, off] = r_u16(data, off);
    if (4 + l === data.length) {
      let ke;
      [ke, off] = r_bytes(data, off, l);
      return [{ group: g, key_exchange: ke }];
    }
  }
  let off2 = 0;
  let listBytes;
  [listBytes, off2] = r_u16(data, off2);
  let end = off2 + listBytes;
  let out = [];
  while (off2 < end) {
    let g2;
    [g2, off2] = r_u16(data, off2);
    let l2;
    [l2, off2] = r_u16(data, off2);
    let ke2;
    [ke2, off2] = r_bytes(data, off2, l2);
    out.push({ group: g2, key_exchange: ke2 });
  }
  return out;
};
exts.ALPN.encode = function(value) {
  let list = Array.isArray(value) ? value : [];
  let total = 2;
  let items = [];
  for (let i = 0; i < list.length; i++) {
    let p = toU8(list[i]);
    items.push(p);
    total += 1 + p.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  off = w_u16(out, off, total - 2);
  for (let j = 0; j < items.length; j++) {
    off = w_u8(out, off, items[j].length);
    off = w_bytes(out, off, items[j]);
  }
  return out;
};
exts.ALPN.decode = function(data) {
  let off = 0;
  let n;
  [n, off] = r_u16(data, off);
  let end = off + n;
  if (end > data.length) throw parseError("ALPN list length exceeds extension body");
  if (end < data.length) throw parseError("trailing data after ALPN protocol list");
  let out = [];
  while (off < end) {
    let l;
    [l, off] = r_u8(data, off);
    if (l === 0) throw parseError("ALPN protocol name of zero length");
    if (off + l > end) throw parseError("ALPN protocol name overruns the list");
    let v;
    [v, off] = r_bytes(data, off, l);
    out.push(new TextDecoder().decode(v));
  }
  return out;
};
exts.RENEGOTIATION_INFO.encode = function(value) {
  let rb = toU8(value || new Uint8Array(0));
  return veclen(1, rb);
};
exts.RENEGOTIATION_INFO.decode = function(data) {
  let off = 0;
  let v;
  [v, off] = readVec(data, off, 1);
  return v;
};
exts.COOKIE.encode = function(value) {
  let v = toU8(value || new Uint8Array(0));
  return veclen(2, v);
};
exts.COOKIE.decode = function(data) {
  let off = 0;
  let v;
  [v, off] = readVec(data, off, 2);
  return v;
};
exts.SESSION_TICKET.encode = function(value) {
  return toU8(value || new Uint8Array(0));
};
exts.SESSION_TICKET.decode = function(data) {
  return data;
};
exts.EXTENDED_MASTER_SECRET.encode = function(value) {
  return new Uint8Array(0);
};
exts.EXTENDED_MASTER_SECRET.decode = function(data) {
  return true;
};
function ext_name_by_code(code) {
  for (let k in TLS_EXT) {
    if (TLS_EXT[k] >>> 0 === code >>> 0) return k;
  }
  return "EXT_" + code;
}
function build_extensions(list) {
  if (!list || !list.length) {
    const e = new Uint8Array(2);
    w_u16(e, 0, 0);
    return e;
  }
  let parts = [];
  let total = 2;
  for (let i = 0; i < list.length; i++) {
    let t = list[i].type;
    if (typeof t === "string") {
      t = TLS_EXT[t];
    }
    let payload;
    if (list[i].data) {
      payload = list[i].data;
    } else {
      let regKey = ext_name_by_code(t);
      let enc = exts[regKey] && exts[regKey].encode;
      payload = enc ? enc(list[i].value) : new Uint8Array(0);
    }
    const rec = new Uint8Array(4 + payload.length);
    let off = 0;
    off = w_u16(rec, off, t >>> 0);
    off = w_u16(rec, off, payload.length);
    off = w_bytes(rec, off, payload);
    parts.push(rec);
    total += rec.length;
  }
  const out = new Uint8Array(total);
  let off2 = 0;
  off2 = w_u16(out, off2, total - 2);
  for (let j = 0; j < parts.length; j++) {
    off2 = w_bytes(out, off2, parts[j]);
  }
  return out;
}
function parse_extension_list(buf) {
  let off = 0;
  let out = [];
  let seen = {};
  while (off < buf.length) {
    let t;
    [t, off] = r_u16(buf, off);
    let l;
    [l, off] = r_u16(buf, off);
    if (off + l > buf.length) throw parseError("extension body overflows extension list");
    let d;
    [d, off] = r_bytes(buf, off, l);
    if (seen[t] === true) {
      throw parseError("duplicate extension type " + t, TLS_ALERT.DECODE_ERROR);
    }
    seen[t] = true;
    let name = ext_name_by_code(t);
    let dec = exts[name] && exts[name].decode;
    let val = dec ? dec(d) : null;
    out.push({ type: t, name, data: d, value: val });
  }
  return out;
}
function parse_extensions(buf) {
  let off = 0;
  let n;
  [n, off] = r_u16(buf, off);
  let end = off + n;
  if (end > buf.length) throw parseError("extensions vector length exceeds body");
  if (end < buf.length) throw parseError("trailing data after extensions vector");
  return parse_extension_list(buf.subarray(off, end));
}
function build_hello(params) {
  params = params || {};
  let kind = params.kind;
  let isDtls = params.cookie !== void 0 || params.version !== void 0 && (params.version & 65280) === 65024;
  let legacy_version = isDtls ? DTLS_VERSION.DTLS1_2 : TLS_VERSION.TLS1_2;
  let sid = toU8(params.session_id || "");
  if (sid.length > 32) sid = sid.subarray(0, 32);
  let extsBuf = build_extensions(params.extensions || []);
  if (kind === "client") {
    let cs = params.cipher_suites;
    if (!Array.isArray(cs) || cs.length === 0) {
      throw new Error("build_hello: ClientHello requires a non-empty cipher_suites array");
    }
    const csBlock = new Uint8Array(2 + cs.length * 2);
    let o = 0;
    o = w_u16(csBlock, o, cs.length * 2);
    for (let i = 0; i < cs.length; i++) {
      o = w_u16(csBlock, o, cs[i]);
    }
    let comp = params.legacy_compression || [0];
    const compBlock = new Uint8Array(1 + comp.length);
    let oc = 0;
    oc = w_u8(compBlock, oc, comp.length);
    for (let j = 0; j < comp.length; j++) {
      oc = w_u8(compBlock, oc, comp[j]);
    }
    let cookieBuf = null;
    if (params.cookie !== void 0) {
      let cookie = toU8(params.cookie);
      cookieBuf = new Uint8Array(1 + cookie.length);
      cookieBuf[0] = cookie.length;
      if (cookie.length > 0) cookieBuf.set(cookie, 1);
    }
    const out = new Uint8Array(
      2 + 32 + 1 + sid.length + (cookieBuf ? cookieBuf.length : 0) + csBlock.length + compBlock.length + extsBuf.length
    );
    let off = 0;
    off = w_u16(out, off, legacy_version);
    off = w_bytes(out, off, params.random);
    off = w_u8(out, off, sid.length);
    off = w_bytes(out, off, sid);
    if (cookieBuf) off = w_bytes(out, off, cookieBuf);
    off = w_bytes(out, off, csBlock);
    off = w_bytes(out, off, compBlock);
    off = w_bytes(out, off, extsBuf);
    return out;
  }
  if (kind === "server") {
    let cipher_suite = typeof params.cipher_suite === "number" ? params.cipher_suite : 4865;
    const out2 = new Uint8Array(2 + 32 + 1 + sid.length + 2 + 1 + extsBuf.length);
    let off2 = 0;
    off2 = w_u16(out2, off2, legacy_version);
    off2 = w_bytes(out2, off2, params.random);
    off2 = w_u8(out2, off2, sid.length);
    off2 = w_bytes(out2, off2, sid);
    off2 = w_u16(out2, off2, cipher_suite);
    off2 = w_u8(out2, off2, 0);
    off2 = w_bytes(out2, off2, extsBuf);
    return out2;
  }
  throw new Error('build_hello: kind must be "client" or "server"');
}
function parse_hello(params) {
  let hsType = params.kind;
  let body = params.body;
  let isClient = hsType === "client" || hsType === TLS_MESSAGE_TYPE.CLIENT_HELLO || hsType === "client_hello";
  let off = 0;
  let legacy_version;
  [legacy_version, off] = r_u16(body, off);
  let random;
  [random, off] = r_bytes(body, off, 32);
  let sidLen;
  [sidLen, off] = r_u8(body, off);
  let session_id;
  [session_id, off] = r_bytes(body, off, sidLen);
  let cipher_suites = [];
  let legacy_compression = [];
  let type = isClient ? "client_hello" : "server_hello";
  let dtls_cookie = null;
  let isDTLS = (legacy_version & 65280) === 65024;
  if (isClient) {
    if (isDTLS) {
      let cookieLen;
      [cookieLen, off] = r_u8(body, off);
      if (cookieLen > 0) {
        [dtls_cookie, off] = r_bytes(body, off, cookieLen);
      }
    }
    let csLen;
    [csLen, off] = r_u16(body, off);
    let csEnd = off + csLen;
    while (off < csEnd) {
      let cs;
      [cs, off] = r_u16(body, off);
      cipher_suites.push(cs);
    }
    let compLen;
    [compLen, off] = r_u8(body, off);
    for (let i = 0; i < compLen; i++) {
      let c;
      [c, off] = r_u8(body, off);
      legacy_compression.push(c);
    }
  } else {
    let cipher_suite;
    [cipher_suite, off] = r_u16(body, off);
    cipher_suites = [cipher_suite];
    let comp;
    [comp, off] = r_u8(body, off);
    legacy_compression = [comp];
  }
  let extensions = [];
  if (body.length > off) {
    let extRaw = body.subarray(off);
    extensions = parse_extensions(extRaw);
  }
  let version = legacy_version;
  return {
    type,
    // 'client_hello' / 'server_hello'
    legacy_version,
    // single (u16)
    version,
    // single (u16)
    random,
    // single (Uint8Array(32))
    session_id,
    // single (Uint8Array)
    dtls_cookie,
    // Uint8Array or null (DTLS only)
    cipher_suites,
    // array
    legacy_compression,
    // array
    extensions
    // array
  };
}
function isVec2(u82) {
  if (!(u82 instanceof Uint8Array) || u82.length < 2) return false;
  let len = u82[0] << 8 | u82[1];
  return u82.length === 2 + len;
}
function build_certificate(params) {
  let v = params.version || TLS_VERSION.TLS1_2;
  let entries = Array.isArray(params.entries) ? params.entries.slice() : null;
  if (!entries && Array.isArray(params.certs)) {
    entries = params.certs.map(function(c) {
      return { cert: c };
    });
  }
  if (!entries) entries = [];
  if (v === TLS_VERSION.TLS1_3) {
    let ctx = toU8(params.request_context || new Uint8Array(0));
    let entryParts = [];
    for (let i = 0; i < entries.length; i++) {
      let certBytes = toU8(entries[i].cert || new Uint8Array(0));
      let certVec = veclen(3, certBytes);
      let extRaw = entries[i].extensions;
      if (Array.isArray(extRaw)) {
        extRaw = build_extensions(extRaw);
      } else if (extRaw instanceof Uint8Array) {
        extRaw = isVec2 && isVec2(extRaw) ? extRaw : veclen(2, extRaw);
      } else {
        extRaw = veclen(2, new Uint8Array(0));
      }
      entryParts.push(certVec, extRaw);
    }
    let ctxVec = veclen(1, ctx);
    let listVec = veclen(3, concatUint8Arrays2(entryParts));
    return concatUint8Arrays2([ctxVec, listVec]);
  } else {
    let certListParts = [];
    for (let j = 0; j < entries.length; j++) {
      let c = toU8(entries[j].cert || new Uint8Array(0));
      certListParts.push(veclen(3, c));
    }
    return veclen(3, concatUint8Arrays2(certListParts));
  }
}
function parse_certificate(body) {
  if (body && body.length >= 4) {
    let off = 0;
    let rcLen;
    [rcLen, off] = r_u8(body, off);
    const afterCtx = off + rcLen;
    if (afterCtx + 3 <= body.length) {
      let listLen, off2 = afterCtx;
      [listLen, off2] = r_u24(body, off2);
      if (afterCtx + 3 + listLen === body.length) {
        const request_context = body.subarray(off, off + rcLen);
        off = off2;
        const end = off2 + listLen;
        const entries = [];
        while (off < end) {
          let certLen;
          [certLen, off] = r_u24(body, off);
          let cert;
          [cert, off] = r_bytes(body, off, certLen);
          let extLen;
          [extLen, off] = r_u16(body, off);
          let extRaw;
          [extRaw, off] = r_bytes(body, off, extLen);
          const extensions = parse_extension_list(extRaw);
          entries.push({ cert, extensions });
        }
        return {
          version: TLS_VERSION.TLS1_3,
          request_context,
          entries
        };
      }
    }
  }
  let off3 = 0;
  let listLen2;
  [listLen2, off3] = r_u24(body, off3);
  const end2 = off3 + listLen2;
  if (end2 !== body.length) {
  }
  const entries12 = [];
  while (off3 < Math.min(end2, body.length)) {
    let len3;
    [len3, off3] = r_u24(body, off3);
    let cert;
    [cert, off3] = r_bytes(body, off3, len3);
    entries12.push({ cert });
  }
  return {
    version: TLS_VERSION.TLS1_2,
    entries: entries12
  };
}
function build_certificate_verify(scheme, signature) {
  let sig = toU8(signature || new Uint8Array(0));
  let alg = scheme >>> 0;
  const out = new Uint8Array(2 + 2 + sig.length);
  let off = 0;
  off = w_u16(out, off, alg);
  off = w_u16(out, off, sig.length);
  off = w_bytes(out, off, sig);
  return out;
}
function parse_certificate_verify(body) {
  let off = 0;
  let alg;
  [alg, off] = r_u16(body, off);
  let slen;
  [slen, off] = r_u16(body, off);
  let sig;
  [sig, off] = r_bytes(body, off, slen);
  if (off !== body.length) throw parseError("trailing data after CertificateVerify signature");
  if (slen === 0) throw parseError("empty CertificateVerify signature");
  return { scheme: alg, signature: sig };
}
function build_new_session_ticket(p) {
  let lifetime = (p && p.ticket_lifetime) >>> 0;
  let age_add = (p && p.ticket_age_add) >>> 0;
  let nonce = toU8(p && p.ticket_nonce || new Uint8Array(0));
  let ticket = toU8(p && p.ticket || new Uint8Array(0));
  let extsBuf = Array.isArray(p && p.extensions) ? build_extensions(p.extensions) : p && p.extensions || veclen(2, new Uint8Array(0));
  const out = new Uint8Array(4 + 4 + 1 + nonce.length + 2 + ticket.length + extsBuf.length);
  let off = 0;
  off = w_u8(out, off, lifetime >>> 24 & 255);
  off = w_u8(out, off, lifetime >>> 16 & 255);
  off = w_u8(out, off, lifetime >>> 8 & 255);
  off = w_u8(out, off, lifetime & 255);
  off = w_u8(out, off, age_add >>> 24 & 255);
  off = w_u8(out, off, age_add >>> 16 & 255);
  off = w_u8(out, off, age_add >>> 8 & 255);
  off = w_u8(out, off, age_add & 255);
  off = w_u8(out, off, nonce.length);
  off = w_bytes(out, off, nonce);
  off = w_u16(out, off, ticket.length);
  off = w_bytes(out, off, ticket);
  off = w_bytes(out, off, extsBuf);
  return out;
}
function parse_new_session_ticket(body) {
  let off = 0;
  let lifetime = (body[off] << 24 | body[off + 1] << 16 | body[off + 2] << 8 | body[off + 3]) >>> 0;
  off += 4;
  let age_add = (body[off] << 24 | body[off + 1] << 16 | body[off + 2] << 8 | body[off + 3]) >>> 0;
  off += 4;
  let nlen;
  [nlen, off] = r_u8(body, off);
  let nonce;
  [nonce, off] = r_bytes(body, off, nlen);
  let tlen;
  [tlen, off] = r_u16(body, off);
  let ticket;
  [ticket, off] = r_bytes(body, off, tlen);
  if (tlen === 0) throw parseError("NewSessionTicket carries an empty ticket");
  let extBuf = body.subarray(off);
  let extensions = extBuf.length ? parse_extensions(extBuf) : [];
  return {
    ticket_lifetime: lifetime,
    ticket_age_add: age_add,
    ticket_nonce: nonce,
    ticket,
    extensions
  };
}
function build_certificate_request(params) {
  let v = params && params.version || TLS_VERSION.TLS1_3;
  if (v === TLS_VERSION.TLS1_3) {
    let ctx = toU8(params && params.request_context || new Uint8Array(0));
    let extsBuf;
    if (params && params.extensions && !Array.isArray(params.extensions)) {
      extsBuf = params.extensions;
    } else {
      let extList = Array.isArray(params && params.extensions) ? params.extensions.slice() : [];
      let hasSigAlgs = false;
      for (let i = 0; i < extList.length; i++) {
        let t = extList[i] && extList[i].type;
        if (t === "SIGNATURE_ALGORITHMS" || t === TLS_EXT.SIGNATURE_ALGORITHMS) {
          hasSigAlgs = true;
          break;
        }
      }
      if (!hasSigAlgs) {
        let sa = params && params.signature_algorithms || [];
        if (sa.length === 0) {
          throw new Error("build_certificate_request: TLS 1.3 requires a non-empty signature_algorithms list");
        }
        extList.unshift({ type: "SIGNATURE_ALGORITHMS", value: sa });
      }
      extsBuf = build_extensions(extList);
    }
    let ctxVec = veclen(1, ctx);
    return concatUint8Arrays2([ctxVec, extsBuf]);
  }
  let typesArr = params && params.certificate_types || [1];
  const typesBuf = new Uint8Array(typesArr.length);
  for (let i = 0; i < typesArr.length; i++) typesBuf[i] = typesArr[i] & 255;
  let typesVec = veclen(1, typesBuf);
  let sigalgs = params && params.signature_algorithms || [];
  const sigBuf = new Uint8Array(sigalgs.length * 2);
  let o = 0;
  for (let j = 0; j < sigalgs.length; j++) o = w_u16(sigBuf, o, sigalgs[j]);
  let sigVec = sigalgs.length ? veclen(2, sigBuf) : new Uint8Array(0);
  let cas = params && params.certificate_authorities || [];
  let caParts = [];
  let caTotal = 0;
  for (let k = 0; k < cas.length; k++) {
    let dn = toU8(cas[k]);
    const ent = new Uint8Array(2 + dn.length);
    let oo = 0;
    oo = w_u16(ent, oo, dn.length);
    oo = w_bytes(ent, oo, dn);
    caParts.push(ent);
    caTotal += ent.length;
  }
  let caVec = veclen(2, caParts.length ? concatUint8Arrays2(caParts) : new Uint8Array(0));
  return concatUint8Arrays2([typesVec, sigVec, caVec]);
}
function parse_certificate_request(body) {
  if (body.length >= 3) {
    let ctxLen = body[0];
    if (1 + ctxLen + 2 <= body.length) {
      let extLen = body[1 + ctxLen] << 8 | body[2 + ctxLen];
      if (1 + ctxLen + 2 + extLen === body.length) {
        let ctx = body.subarray(1, 1 + ctxLen);
        let extBuf = body.subarray(1 + ctxLen + 2);
        let crExts = parse_extension_list(extBuf);
        let hasSigAlgs = false;
        for (let ci = 0; ci < crExts.length; ci++) {
          if (crExts[ci] && crExts[ci].type === TLS_EXT.SIGNATURE_ALGORITHMS) {
            hasSigAlgs = true;
            break;
          }
        }
        if (!hasSigAlgs) {
          throw parseError("TLS 1.3 CertificateRequest without the mandatory signature_algorithms extension");
        }
        return {
          version: TLS_VERSION.TLS1_3,
          request_context: ctx,
          // extBuf skips the 2-byte prefix (validated as extLen above), so it
          // is a bare list — this was reading the prefix twice and breaking
          // every CertificateRequest.
          extensions: crExts
        };
      }
    }
  }
  let off = 0;
  let typesBytes, off1;
  [typesBytes, off1] = readVec(body, off, 1);
  off = off1;
  let certificate_types = [];
  for (let i = 0; i < typesBytes.length; i++) certificate_types.push(typesBytes[i] >>> 0);
  let signature_algorithms = [];
  if (off + 2 <= body.length) {
    let sigLen = body[off] << 8 | body[off + 1];
    if (off + 2 + sigLen <= body.length) {
      off += 2;
      let endSig = off + sigLen;
      while (off < endSig) {
        let alg;
        [alg, off] = r_u16(body, off);
        signature_algorithms.push(alg);
      }
    }
  }
  let cas = [];
  if (off + 2 <= body.length) {
    let caLen;
    [caLen, off] = r_u16(body, off);
    let end = off + caLen;
    while (off < end) {
      let dnLen;
      [dnLen, off] = r_u16(body, off);
      let dn;
      [dn, off] = r_bytes(body, off, dnLen);
      cas.push(dn);
    }
  }
  return {
    version: TLS_VERSION.TLS1_2,
    certificate_types,
    signature_algorithms,
    certificate_authorities: cas
  };
}
function build_hello_retry_request(params) {
  let rnd = TLS13_HRR_RANDOM;
  let sid = params && params.session_id ? toU8(params.session_id) : new Uint8Array(0);
  let legacy_version = TLS_VERSION.TLS1_2;
  let extList = [];
  extList.push({ type: "SUPPORTED_VERSIONS", value: params && params.selected_version || TLS_VERSION.TLS1_3 });
  if (params && params.selected_group != null) {
    let ks_data = new Uint8Array(2);
    ks_data[0] = params.selected_group >> 8 & 255;
    ks_data[1] = params.selected_group & 255;
    extList.push({ type: 51, data: ks_data });
  }
  if (params && params.cookie) {
    extList.push({ type: "COOKIE", value: params.cookie });
  }
  if (params && Array.isArray(params.other_exts)) {
    for (let i = 0; i < params.other_exts.length; i++) extList.push(params.other_exts[i]);
  }
  let extsBuf = build_extensions(extList);
  let cipher_suite = params && typeof params.cipher_suite === "number" ? params.cipher_suite : 4865;
  const out = new Uint8Array(2 + 32 + 1 + sid.length + 2 + 1 + extsBuf.length);
  let off = 0;
  off = w_u16(out, off, legacy_version);
  off = w_bytes(out, off, rnd);
  off = w_u8(out, off, sid.length);
  if (sid.length > 0) off = w_bytes(out, off, sid);
  off = w_u16(out, off, cipher_suite);
  off = w_u8(out, off, 0);
  off = w_bytes(out, off, extsBuf);
  return out;
}
function build_server_key_exchange_ecdhe(p) {
  let pub = toU8(p.public_key || new Uint8Array(0));
  const head = new Uint8Array(1 + 2 + 1 + pub.length);
  let off = 0;
  off = w_u8(head, off, 3);
  off = w_u16(head, off, p.group >>> 0);
  off = w_u8(head, off, pub.length);
  off = w_bytes(head, off, pub);
  let sig = toU8(p.signature || new Uint8Array(0));
  const sigpart = new Uint8Array(2 + 2 + sig.length);
  let o2 = 0;
  o2 = w_u16(sigpart, o2, p.sig_alg >>> 0);
  o2 = w_u16(sigpart, o2, sig.length);
  o2 = w_bytes(sigpart, o2, sig);
  return concatUint8Arrays2([head, sigpart]);
}
function parse_server_key_exchange(body) {
  let off = 0;
  let curve_type;
  [curve_type, off] = r_u8(body, off);
  if (curve_type === 3) {
    let group;
    [group, off] = r_u16(body, off);
    let plen;
    [plen, off] = r_u8(body, off);
    let pub;
    [pub, off] = r_bytes(body, off, plen);
    let sig_alg;
    [sig_alg, off] = r_u16(body, off);
    let slen;
    [slen, off] = r_u16(body, off);
    let sig;
    [sig, off] = r_bytes(body, off, slen);
    return { kex: "ECDHE", group, public_key: pub, sig_alg, signature: sig };
  }
  let pLen;
  [pLen, off] = r_u16(body, off);
  let dh_p;
  [dh_p, off] = r_bytes(body, off, pLen);
  let gLen;
  [gLen, off] = r_u16(body, off);
  let dh_g;
  [dh_g, off] = r_bytes(body, off, gLen);
  let yLen;
  [yLen, off] = r_u16(body, off);
  let dh_Ys;
  [dh_Ys, off] = r_bytes(body, off, yLen);
  let sig_alg2;
  [sig_alg2, off] = r_u16(body, off);
  let s2len;
  [s2len, off] = r_u16(body, off);
  let sig2;
  [sig2, off] = r_bytes(body, off, s2len);
  return { kex: "DHE", dh_p, dh_g, dh_Ys, sig_alg: sig_alg2, signature: sig2 };
}
function build_client_key_exchange_ecdhe(pubkey) {
  let p = toU8(pubkey || new Uint8Array(0));
  return veclen(1, p);
}
function build_new_session_ticket_tls12(p) {
  let hint = (p && p.ticket_lifetime_hint) >>> 0;
  let ticket = toU8(p && p.ticket || new Uint8Array(0));
  const out = new Uint8Array(4 + 2 + ticket.length);
  let off = 0;
  off = w_u8(out, off, hint >>> 24 & 255);
  off = w_u8(out, off, hint >>> 16 & 255);
  off = w_u8(out, off, hint >>> 8 & 255);
  off = w_u8(out, off, hint & 255);
  off = w_u16(out, off, ticket.length);
  off = w_bytes(out, off, ticket);
  return out;
}
function parse_new_session_ticket_tls12(body) {
  let off = 0;
  let hint = (body[off] << 24 | body[off + 1] << 16 | body[off + 2] << 8 | body[off + 3]) >>> 0;
  off += 4;
  let tlen;
  [tlen, off] = r_u16(body, off);
  let t;
  [t, off] = r_bytes(body, off, tlen);
  return { ticket_lifetime_hint: hint, ticket: t };
}
function build_message(type, body) {
  const out = new Uint8Array(4 + body.length);
  let off = 0;
  off = w_u8(out, off, type);
  off = w_u24(out, off, body.length);
  off = w_bytes(out, off, body);
  return out;
}
function parse_message(buf) {
  let off = 0;
  let t;
  [t, off] = r_u8(buf, off);
  let l;
  [l, off] = r_u24(buf, off);
  let b;
  [b, off] = r_bytes(buf, off, l);
  return { type: t, body: b };
}
function build_server_ecdh_params(group, public_key) {
  const params = new Uint8Array(1 + 2 + 1 + public_key.length);
  let off = 0;
  off = w_u8(params, off, 3);
  off = w_u16(params, off, group >>> 0);
  off = w_u8(params, off, public_key.length);
  off = w_bytes(params, off, public_key);
  return params;
}
function build_key_update(request_update) {
  return new Uint8Array([request_update ? 1 : 0]);
}
function parse_key_update(body) {
  return { request_update: body[0] || 0 };
}

// node_modules/quico/node_modules/lemon-tls/src/session/signing.js
var TLS_VERSION_TLS1_3 = 772;
var SIG_SCHEMES_MODERN = [
  2055,
  2056,
  // ed25519, ed448
  1027,
  1283,
  1539,
  // ecdsa_secp256r1/384r1/521r1
  2052,
  2053,
  2054
  // rsa_pss_rsae_sha256/384/512
];
var SIG_SCHEMES_LEGACY_PKCS1 = [
  1025,
  1281,
  1537
  // rsa_pkcs1_sha256/384/512
];
var SIG_SCHEMES_LEGACY_SHA1 = [
  513,
  // rsa_pkcs1_sha1
  515
  // ecdsa_sha1
];
function default_signature_schemes() {
  return SIG_SCHEMES_MODERN.concat(SIG_SCHEMES_LEGACY_PKCS1).concat(SIG_SCHEMES_LEGACY_SHA1);
}
function scheme_info(version, scheme) {
  let h = scheme >>> 8 & 255, s = scheme & 255;
  if (scheme === 2055 || scheme === 2056) {
    return { hash: null, sig: "eddsa", isPSS: false };
  }
  if (scheme === 2052 || scheme === 2057) return { hash: "sha256", sig: "rsa", isPSS: true };
  if (scheme === 2053 || scheme === 2058) return { hash: "sha384", sig: "rsa", isPSS: true };
  if (scheme === 2054 || scheme === 2059) return { hash: "sha512", sig: "rsa", isPSS: true };
  if (scheme === 1027) return { hash: "sha256", sig: "ecdsa", isPSS: false };
  if (scheme === 1283) return { hash: "sha384", sig: "ecdsa", isPSS: false };
  if (scheme === 1539) return { hash: "sha512", sig: "ecdsa", isPSS: false };
  if (version === TLS_VERSION_TLS1_3) return null;
  if (h === 2 && s === 1) return { hash: "sha1", sig: "rsa", isPSS: false };
  if (h === 4 && s === 1) return { hash: "sha256", sig: "rsa", isPSS: false };
  if (h === 5 && s === 1) return { hash: "sha384", sig: "rsa", isPSS: false };
  if (h === 6 && s === 1) return { hash: "sha512", sig: "rsa", isPSS: false };
  if (h === 2 && s === 3) return { hash: "sha1", sig: "ecdsa", isPSS: false };
  return null;
}
function pick_scheme(version, certKeyObj, peerSupported) {
  if (!Array.isArray(peerSupported) || peerSupported.length === 0) return null;
  let picked = null;
  for (let i = 0; i < peerSupported.length; i++) {
    let s2 = peerSupported[i];
    if (typeof s2 !== "number") continue;
    if (!scheme_matches_key(version, s2, certKeyObj)) continue;
    picked = s2;
    break;
  }
  return picked;
}
function sign_with_scheme(version, scheme, tbs, certKeyObj) {
  let info = scheme_info(version, scheme);
  if (!info) return null;
  if (info.sig === "eddsa") {
    return new Uint8Array((void 0)(null, tbs, certKeyObj));
  }
  if (info.sig === "ecdsa") {
    return new Uint8Array((void 0)(info.hash, tbs, certKeyObj));
  }
  if (info.sig === "rsa") {
    if (info.isPSS) {
      let saltLen = info.hash === "sha256" ? 32 : info.hash === "sha384" ? 48 : 64;
      return new Uint8Array((void 0)(info.hash, tbs, {
        key: certKeyObj,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: saltLen
      }));
    } else {
      return new Uint8Array((void 0)(info.hash, tbs, {
        key: certKeyObj,
        padding: constants.RSA_PKCS1_PADDING
      }));
    }
  }
  return null;
}
function scheme_matches_key(version, scheme, keyObj) {
  let info = scheme_info(version, scheme);
  if (!info || !keyObj) return false;
  let kt = keyObj.asymmetricKeyType;
  if (info.sig === "rsa") {
    if (info.isPSS) {
      let wantsPssKey = scheme === 2057 || scheme === 2058 || scheme === 2059;
      if (wantsPssKey) return kt === "rsa-pss";
      return kt === "rsa";
    }
    return kt === "rsa";
  }
  if (info.sig === "ecdsa") {
    if (kt !== "ec") return false;
    let curve = null;
    try {
      curve = keyObj.asymmetricKeyDetails && keyObj.asymmetricKeyDetails.namedCurve;
    } catch (e) {
      curve = null;
    }
    if (!curve) return true;
    let want = scheme === 1027 ? "prime256v1" : scheme === 1283 ? "secp384r1" : scheme === 1539 ? "secp521r1" : null;
    return want === null || curve === want;
  }
  if (info.sig === "eddsa") {
    if (scheme === 2055) return kt === "ed25519";
    if (scheme === 2056) return kt === "ed448";
    return false;
  }
  return false;
}
function verify_with_scheme(version, scheme, tbs, publicKey, signature) {
  let info = scheme_info(version, scheme);
  if (!info) return false;
  if (!scheme_matches_key(version, scheme, publicKey)) return false;
  try {
    if (info.sig === "eddsa") {
      return verify(null, tbs, publicKey, signature);
    }
    if (info.sig === "ecdsa") {
      return verify(info.hash, tbs, publicKey, signature);
    }
    if (info.sig === "rsa") {
      if (info.isPSS) {
        let saltLen = info.hash === "sha256" ? 32 : info.hash === "sha384" ? 48 : 64;
        return verify(info.hash, tbs, {
          key: publicKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: saltLen
        }, signature);
      }
      return verify(info.hash, tbs, {
        key: publicKey,
        padding: constants.RSA_PKCS1_PADDING
      }, signature);
    }
  } catch (e) {
    return false;
  }
  return false;
}

// scripts/shims/empty.js
var empty_default = {};
var Duplex = class {
};

// node_modules/quico/node_modules/lemon-tls/src/secure_context.js
function looksLikePath(x) {
  return typeof x === "string" && x.indexOf("\n") === -1 && x.length < 4096 && x.indexOf("-----BEGIN") === -1;
}
function readMaybeFile(x) {
  if (x == null) return null;
  if (looksLikePath(x)) return empty_default.readFileSync(empty_default.resolve(String(x)));
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof Uint8Array) return Buffer.from(x);
  if (typeof x === "string") return Buffer.from(x, "utf8");
  throw new Error("Unsupported input type (expected path/string/Buffer/Uint8Array).");
}
function isPEM(buf) {
  if (!buf) return false;
  let s = buf.toString("utf8");
  return s.indexOf("-----BEGIN ") !== -1 && s.indexOf("-----END ") !== -1;
}
function splitPEMBlocks(pemText) {
  let out = [];
  let re = /-----BEGIN ([A-Z0-9 \-]+)-----([\s\S]*?)-----END \1-----/g;
  let m;
  while ((m = re.exec(pemText)) !== null) {
    let typ = m[1].trim();
    let b64 = m[2].replace(/[\r\n\s]/g, "");
    let derBuf = Buffer.from(b64, "base64");
    out.push({ type: typ, der: new Uint8Array(derBuf) });
  }
  return out;
}
function ensureArray(x) {
  return x == null ? [] : Array.isArray(x) ? x : [x];
}
function normalizeCA(caOption) {
  let arr = ensureArray(caOption);
  let ders = [];
  for (let i = 0; i < arr.length; i++) {
    let raw = readMaybeFile(arr[i]);
    if (!raw) continue;
    if (isPEM(raw)) {
      let blocks = splitPEMBlocks(raw.toString("utf8"));
      for (let j = 0; j < blocks.length; j++) {
        if (blocks[j].type.indexOf("CERTIFICATE") !== -1) ders.push(blocks[j].der);
      }
    } else {
      ders.push(new Uint8Array(raw));
    }
  }
  return ders;
}
function makeX509FromDerOrPem(buf) {
  return new browser_crypto_shim_default.X509Certificate(Buffer.from(buf));
}
function makePrivateKeyFromDerOrPem(buf, passphrase) {
  if (isPEM(buf)) {
    return browser_crypto_shim_default.createPrivateKey({ key: buf, format: "pem", passphrase });
  } else {
    let der = Buffer.from(buf), keyObj = null;
    try {
      keyObj = browser_crypto_shim_default.createPrivateKey({ key: der, format: "der", type: "pkcs8", passphrase });
    } catch (e1) {
      try {
        keyObj = browser_crypto_shim_default.createPrivateKey({ key: der, format: "der", type: "pkcs1", passphrase });
      } catch (e2) {
        keyObj = browser_crypto_shim_default.createPrivateKey({ key: der, format: "der", type: "sec1", passphrase });
      }
    }
    return keyObj;
  }
}
function exportKeyPkcs8Der(keyObj) {
  return new Uint8Array(keyObj.export({ format: "der", type: "pkcs8" }));
}
function u8eq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function dedupeDerArray(arr) {
  let out = [];
  for (let i = 0; i < arr.length; i++) {
    let keep = true;
    for (let j = 0; j < out.length; j++) {
      if (u8eq(arr[i], out[j])) {
        keep = false;
        break;
      }
    }
    if (keep) out.push(arr[i]);
  }
  return out;
}
function createSecureContext(options) {
  if (!options) options = {};
  let certBlocksDer = [];
  let certObjs = [];
  if (options.cert != null) {
    let cRaw = readMaybeFile(options.cert);
    if (isPEM(cRaw)) {
      let blocks = splitPEMBlocks(cRaw.toString("utf8"));
      for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].type.indexOf("CERTIFICATE") !== -1) {
          certBlocksDer.push(blocks[i].der);
          certObjs.push(makeX509FromDerOrPem(blocks[i].der));
        }
      }
    } else {
      const der = new Uint8Array(cRaw);
      certBlocksDer.push(der);
      certObjs.push(makeX509FromDerOrPem(der));
    }
  }
  let keyObj = null;
  let privateKey = null;
  if (options.key != null) {
    let kRaw = readMaybeFile(options.key);
    keyObj = makePrivateKeyFromDerOrPem(kRaw, options.passphrase);
    privateKey = exportKeyPkcs8Der(keyObj);
  }
  if (!options.pfx) {
    if (certBlocksDer.length === 0) throw new Error("createSecureContext: missing cert.");
    if (!privateKey) throw new Error("createSecureContext: missing private key.");
  }
  let ca = normalizeCA(options.ca);
  let ocsp = null;
  if (options.ocsp != null) ocsp = new Uint8Array(readMaybeFile(options.ocsp));
  let ticketKeys = null;
  if (options.ticketKeys != null) ticketKeys = new Uint8Array(readMaybeFile(options.ticketKeys));
  let chainDer = dedupeDerArray(certBlocksDer);
  let certificateChain = [];
  for (let c = 0; c < chainDer.length; c++) {
    certificateChain.push({ cert: chainDer[c] });
  }
  let leafPublicKeyType = null;
  if (certObjs.length > 0 && certObjs[0].publicKey) {
    try {
      leafPublicKeyType = certObjs[0].publicKey.asymmetricKeyType || null;
    } catch (e) {
      leafPublicKeyType = null;
    }
  }
  return {
    // חומר לשכבת ההנדשייק/רקורד:
    certificateChain,
    // [{ cert: DER(Uint8Array) }, ...]
    privateKey,
    // PKCS#8 DER (Uint8Array)
    ca,
    // Trust store (DER)
    ocsp,
    // DER (אם הוגדר)
    ticketKeys,
    // Uint8Array (אם הוגדר)
    // עזרי debug/לוגיקה:
    certObjs,
    // [X509Certificate...]
    keyObj,
    // KeyObject
    leafPublicKeyType,
    // פרמטרים פרוטוקוליים (אחסון; אתה מפרש בזמן ה-handshake):
    minVersion: String(options.minVersion || "TLSv1.2"),
    maxVersion: String(options.maxVersion || "TLSv1.3"),
    ciphers: options.ciphers || null,
    sigalgs: options.sigalgs || null,
    ecdhCurve: options.ecdhCurve || null,
    honorCipherOrder: !!options.honorCipherOrder,
    // תמיכה ב־PFX אם תרצה לטפל בזה בשכבה אחרת:
    pfx: options.pfx ? new Uint8Array(readMaybeFile(options.pfx)) : null,
    passphrase: options.passphrase ? String(options.passphrase) : null
  };
}
var secure_context_default = createSecureContext;

// node_modules/quico/node_modules/lemon-tls/src/session/ecdh.js
var X25519_PKCS8_PREFIX2 = Buffer.from("302e020100300506032b656e04220420", "hex");
var X25519_SPKI_PREFIX2 = Buffer.from("302a300506032b656e032100", "hex");
function x25519_get_public_key(privateKeyRaw) {
  let der = Buffer.concat([X25519_PKCS8_PREFIX2, Buffer.from(privateKeyRaw)]);
  let privObj = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  let pubObj = createPublicKey(privObj);
  let spki = pubObj.export({ type: "spki", format: "der" });
  return new Uint8Array(spki.subarray(X25519_SPKI_PREFIX2.length));
}
function x25519_get_shared_secret(localPrivateRaw, remotePublicRaw) {
  let privDer = Buffer.concat([X25519_PKCS8_PREFIX2, Buffer.from(localPrivateRaw)]);
  let pubDer = Buffer.concat([X25519_SPKI_PREFIX2, Buffer.from(remotePublicRaw)]);
  let privObj = createPrivateKey({ key: privDer, format: "der", type: "pkcs8" });
  let pubObj = createPublicKey({ key: pubDer, format: "der", type: "spki" });
  let secret = new Uint8Array(diffieHellman({ privateKey: privObj, publicKey: pubObj }));
  let allZero = true;
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) {
    throw new Error("X25519: all-zero shared secret \u2014 invalid peer public key (RFC 7748 \xA76.1)");
  }
  return secret;
}
function p256_generate_keypair() {
  let ecdh2 = createECDH("prime256v1");
  ecdh2.generateKeys();
  return {
    private_key: new Uint8Array(ecdh2.getPrivateKey()),
    public_key: new Uint8Array(ecdh2.getPublicKey(null, "uncompressed"))
  };
}
function p256_get_shared_secret(localPrivateRaw, remotePublicRaw) {
  let ecdh2 = createECDH("prime256v1");
  ecdh2.setPrivateKey(Buffer.from(localPrivateRaw));
  return new Uint8Array(ecdh2.computeSecret(Buffer.from(remotePublicRaw)));
}
function p384_generate_keypair() {
  let ecdh2 = createECDH("secp384r1");
  ecdh2.generateKeys();
  return {
    private_key: new Uint8Array(ecdh2.getPrivateKey()),
    public_key: new Uint8Array(ecdh2.getPublicKey(null, "uncompressed"))
  };
}
function p384_get_shared_secret(localPrivateRaw, remotePublicRaw) {
  let ecdh2 = createECDH("secp384r1");
  ecdh2.setPrivateKey(Buffer.from(localPrivateRaw));
  return new Uint8Array(ecdh2.computeSecret(Buffer.from(remotePublicRaw)));
}
var NAMED_GROUP = {
  X25519: 29,
  SECP256R1: 23,
  SECP384R1: 24
};
var SUPPORTED_GROUPS = [
  NAMED_GROUP.X25519,
  // preferred: fastest, no point validation pitfalls
  NAMED_GROUP.SECP256R1,
  NAMED_GROUP.SECP384R1
];
function is_supported_group(group) {
  return SUPPORTED_GROUPS.indexOf(group) >= 0;
}
function generate_keypair(group) {
  if (group === NAMED_GROUP.X25519) {
    let priv = new Uint8Array(randomBytes4(32));
    return { private_key: priv, public_key: x25519_get_public_key(priv) };
  }
  if (group === NAMED_GROUP.SECP256R1) return p256_generate_keypair();
  if (group === NAMED_GROUP.SECP384R1) return p384_generate_keypair();
  return null;
}
function normalize_peer_public_key(group, pub) {
  if (!pub || pub.length === 0) throw new Error("empty key_exchange");
  if (group === NAMED_GROUP.X25519) {
    if (pub.length !== 32) {
      throw new Error("X25519 key_exchange must be 32 bytes, got " + pub.length);
    }
    return pub;
  }
  let coordLen = group === NAMED_GROUP.SECP256R1 ? 32 : group === NAMED_GROUP.SECP384R1 ? 48 : 0;
  if (coordLen === 0) throw new Error("unsupported group 0x" + (group >>> 0).toString(16));
  let expected = 1 + 2 * coordLen;
  if (pub.length !== expected) {
    if (pub.length === 2 * coordLen) {
      throw new Error("key_exchange is missing the 0x04 uncompressed-point prefix (got " + pub.length + " bytes, expected " + expected + ")");
    }
    if (pub.length === 1 + coordLen && (pub[0] === 2 || pub[0] === 3)) {
      throw new Error("compressed points are not permitted; key_exchange must be uncompressed (RFC 8446 \xA74.2.8.2)");
    }
    throw new Error("key_exchange must be a " + expected + "-byte uncompressed point, got " + pub.length);
  }
  if (pub[0] !== 4) {
    throw new Error("key_exchange must start with the 0x04 uncompressed-point marker, got 0x" + pub[0].toString(16));
  }
  return pub;
}
function get_shared_secret(group, localPrivateRaw, remotePublicRaw) {
  let pub = normalize_peer_public_key(group, remotePublicRaw);
  if (group === NAMED_GROUP.X25519) return x25519_get_shared_secret(localPrivateRaw, pub);
  if (group === NAMED_GROUP.SECP256R1) return p256_get_shared_secret(localPrivateRaw, pub);
  if (group === NAMED_GROUP.SECP384R1) return p384_get_shared_secret(localPrivateRaw, pub);
  throw new Error("unsupported group 0x" + (group >>> 0).toString(16));
}

// node_modules/quico/node_modules/lemon-tls/src/session/message.js
function normalize_hello(hello) {
  let out = {};
  for (let key in hello) {
    out[key] = hello[key];
  }
  if ("extensions" in hello && Array.isArray(hello.extensions)) {
    for (let i = 0; i < hello.extensions.length; i++) {
      let e = hello.extensions[i];
      let name = e.name;
      let value = e.value;
      if (name === "SERVER_NAME") {
        out.sni = value;
      } else if (name === "ALPN") {
        out.alpn = value;
      } else if (name === "KEY_SHARE") {
        if (!("key_groups" in out)) out.key_groups = [];
        if (!("supported_groups" in out)) out.supported_groups = [];
        for (let i2 = 0; i2 < value.length; i2++) {
          if (out.supported_groups.indexOf(value[i2].group) < 0) {
            out.supported_groups.push(value[i2].group);
          }
          out.key_groups.push({
            group: value[i2].group,
            public_key: value[i2].key_exchange
          });
        }
      } else if (name === "SUPPORTED_VERSIONS") {
        out.supported_versions = value;
      } else if (name === "SIGNATURE_ALGORITHMS") {
        out.signature_algorithms = value;
      } else if (name === "SIGNATURE_ALGORITHMS_CERT") {
        out.signature_algorithms_cert = value;
      } else if (name === "SUPPORTED_GROUPS") {
        out.supported_groups = value;
      } else if (name === "COOKIE") {
        out.cookie = value;
      } else if (name === "EARLY_DATA") {
        out.early_data = value;
      } else if (name === "PSK_KEY_EXCHANGE_MODES") {
        out.psk_modes = value;
      } else if (name === "PRE_SHARED_KEY") {
        out.pre_shared_key = value;
      } else if (name === "RENEGOTIATION_INFO") {
        out.renegotiation_info = value;
      } else if (name === "STATUS_REQUEST") {
        out.status_request = value;
      } else if (name === "MAX_FRAGMENT_LENGTH") {
        out.max_fragment_length = value;
      } else if (name === "CERTIFICATE_AUTHORITIES") {
        out.certificate_authorities = value;
      } else if (name === "SCT") {
        out.sct = value;
      } else if (name === "HEARTBEAT") {
        out.heartbeat = value;
      } else if (name === "USE_SRTP") {
        out.use_srtp = value;
      } else if (name === "SESSION_TICKET") {
        out.session_ticket = value;
        out.session_ticket_supported = true;
      } else if (name === "EXTENDED_MASTER_SECRET") {
        out.extended_master_secret = true;
      } else {
        if (!("unknown" in out)) out.unknown = [];
        out.unknown.push(e);
      }
    }
  }
  if (!("supported_versions" in out)) {
    out.supported_versions = [];
  }
  if (out.supported_versions.indexOf(out.version) < 0) {
    out.supported_versions.push(out.version);
  }
  return out;
}
function build_tls_message(params) {
  let type = 0;
  let body = null;
  if (params.type == "server_hello") {
    type = TLS_MESSAGE_TYPE.SERVER_HELLO;
    params.kind = "server";
    body = build_hello(params);
  } else if (params.type == "client_hello") {
    type = TLS_MESSAGE_TYPE.CLIENT_HELLO;
    params.kind = "client";
    body = build_hello(params);
  } else if (params.type == "server_key_exchange") {
    type = TLS_MESSAGE_TYPE.SERVER_KEY_EXCHANGE;
    body = build_server_key_exchange_ecdhe(params);
  } else if (params.type == "client_key_exchange") {
    type = TLS_MESSAGE_TYPE.CLIENT_KEY_EXCHANGE;
    body = build_client_key_exchange_ecdhe(params.public_key);
  } else if (params.type == "server_hello_done") {
    type = TLS_MESSAGE_TYPE.SERVER_HELLO_DONE;
    body = new Uint8Array(0);
  } else if (params.type == "encrypted_extensions") {
    type = TLS_MESSAGE_TYPE.ENCRYPTED_EXTENSIONS;
    body = build_extensions(params.extensions);
  } else if (params.type == "certificate") {
    type = TLS_MESSAGE_TYPE.CERTIFICATE;
    body = build_certificate(params);
  } else if (params.type == "certificate_verify") {
    type = TLS_MESSAGE_TYPE.CERTIFICATE_VERIFY;
    body = build_certificate_verify(params.scheme, params.signature);
  } else if (params.type == "finished") {
    type = TLS_MESSAGE_TYPE.FINISHED;
    body = params.data;
  } else if (params.type == "key_update") {
    type = TLS_MESSAGE_TYPE.KEY_UPDATE;
    body = build_key_update(params.request_update);
  } else if (params.type == "certificate_request") {
    type = TLS_MESSAGE_TYPE.CERTIFICATE_REQUEST;
    body = build_certificate_request(params);
  } else if (params.type == "hello_retry_request") {
    type = TLS_MESSAGE_TYPE.SERVER_HELLO;
    body = build_hello_retry_request(params);
  } else if (params.type == "new_session_ticket_tls12") {
    type = TLS_MESSAGE_TYPE.NEW_SESSION_TICKET;
    body = build_new_session_ticket_tls12(params);
  } else if (params.type == "new_session_ticket") {
    type = TLS_MESSAGE_TYPE.NEW_SESSION_TICKET;
    body = build_new_session_ticket(params);
  }
  return build_message(type, body);
}
function parse_tls_message(data, negotiatedVersion) {
  let out = {};
  let message = parse_message(data);
  if (message.type == TLS_MESSAGE_TYPE.CLIENT_HELLO || message.type == TLS_MESSAGE_TYPE.SERVER_HELLO) {
    let kind = message.type == TLS_MESSAGE_TYPE.CLIENT_HELLO ? "client" : "server";
    let hello = parse_hello({ kind, body: message.body });
    out = normalize_hello(hello);
  } else if (message.type == TLS_MESSAGE_TYPE.SERVER_KEY_EXCHANGE) {
    out = parse_server_key_exchange(message.body);
    out.type = "server_key_exchange";
  } else if (message.type == TLS_MESSAGE_TYPE.CLIENT_KEY_EXCHANGE) {
    out.body = message.body;
    out.public_key = message.body.slice(1);
    out.type = "client_key_exchange";
  } else if (message.type == TLS_MESSAGE_TYPE.SERVER_HELLO_DONE) {
    out.body = message.body;
    out.type = "server_hello_done";
  } else if (message.type == TLS_MESSAGE_TYPE.ENCRYPTED_EXTENSIONS) {
    out = normalize_hello({
      extensions: parse_extensions(message.body)
    });
    out.type = "encrypted_extensions";
  } else if (message.type == TLS_MESSAGE_TYPE.CERTIFICATE) {
    out = parse_certificate(message.body);
    out.type = "certificate";
  } else if (message.type == TLS_MESSAGE_TYPE.CERTIFICATE_VERIFY) {
    out = parse_certificate_verify(message.body);
    out.type = "certificate_verify";
    out.body = message.body;
  } else if (message.type == TLS_MESSAGE_TYPE.FINISHED) {
    out.type = "finished";
    out.body = message.body;
  } else if (message.type == TLS_MESSAGE_TYPE.NEW_SESSION_TICKET) {
    if (negotiatedVersion === 771) {
      out = parse_new_session_ticket_tls12(message.body);
    } else {
      out = parse_new_session_ticket(message.body);
    }
    out.type = "new_session_ticket";
  } else if (message.type == TLS_MESSAGE_TYPE.KEY_UPDATE) {
    out = parse_key_update(message.body);
    out.type = "key_update";
  } else if (message.type == TLS_MESSAGE_TYPE.CERTIFICATE_REQUEST) {
    out = parse_certificate_request(message.body);
    out.type = "certificate_request";
    if (out.signature_algorithms === void 0 && Array.isArray(out.extensions)) {
      for (let i = 0; i < out.extensions.length; i++) {
        let e = out.extensions[i];
        if (e && e.type === TLS_EXT.SIGNATURE_ALGORITHMS && Array.isArray(e.value)) {
          out.signature_algorithms = e.value;
          break;
        }
      }
    }
  } else {
    out.type = "unknown_handshake";
    out.handshake_type = message.type;
    out.body = message.body;
  }
  return out;
}

// node_modules/quico/node_modules/lemon-tls/src/session/ticket.js
var KEY_NAME_LEN = 16;
var IV_LEN = 12;
var TAG_LEN = 16;
function split_ticket_keys(ticketKeys) {
  if (!ticketKeys) throw new Error("ticketKeys is required");
  let buf = Buffer.isBuffer(ticketKeys) ? ticketKeys : Buffer.from(ticketKeys);
  if (buf.length !== 48) throw new Error("ticketKeys must be exactly 48 bytes");
  return {
    key_name: buf.slice(0, 16),
    aes_key: buf.slice(16, 48)
  };
}
function encrypt_session_blob(state, ticketKeys) {
  let { key_name, aes_key } = split_ticket_keys(ticketKeys);
  let serialized = Buffer.from(JSON.stringify(serialize_state(state)));
  let iv = randomBytes4(IV_LEN);
  let cipher = createCipheriv("aes-256-gcm", aes_key, iv);
  let ct = cipher.update(serialized);
  cipher.final();
  let tag = cipher.getAuthTag();
  let out = Buffer.concat([key_name, iv, ct, tag]);
  return new Uint8Array(out);
}
function decrypt_session_blob(blob, ticketKeys) {
  try {
    if (!blob || blob.length < KEY_NAME_LEN + IV_LEN + TAG_LEN) return null;
    let buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
    let blob_key_name = buf.slice(0, KEY_NAME_LEN);
    let iv = buf.slice(KEY_NAME_LEN, KEY_NAME_LEN + IV_LEN);
    let tag = buf.slice(buf.length - TAG_LEN);
    let ct = buf.slice(KEY_NAME_LEN + IV_LEN, buf.length - TAG_LEN);
    let { key_name, aes_key } = split_ticket_keys(ticketKeys);
    if (!uint8Equal2(blob_key_name, key_name)) return null;
    let decipher = createDecipheriv("aes-256-gcm", aes_key, iv);
    decipher.setAuthTag(tag);
    let pt = decipher.update(ct);
    decipher.final();
    let state = deserialize_state(JSON.parse(pt.toString("utf8")));
    return state;
  } catch (e) {
    return null;
  }
}
function encode_client_session(state) {
  let serialized = JSON.stringify(serialize_state(state));
  return new Uint8Array(Buffer.from(serialized, "utf8"));
}
function decode_client_session(blob) {
  try {
    if (!blob || blob.length === 0) return null;
    let buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
    return deserialize_state(JSON.parse(buf.toString("utf8")));
  } catch (e) {
    return null;
  }
}
function serialize_state(state) {
  let out = {};
  for (let k in state) {
    let v = state[k];
    if (v == null) {
      out[k] = null;
    } else if (v instanceof Uint8Array || Buffer.isBuffer(v)) {
      out[k] = { $b: Buffer.from(v).toString("base64") };
    } else if (typeof v === "object" && !Array.isArray(v)) {
      out[k] = serialize_state(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
function deserialize_state(obj) {
  if (obj == null) return null;
  let out = {};
  for (let k in obj) {
    let v = obj[k];
    if (v == null) {
      out[k] = null;
    } else if (typeof v === "object" && typeof v.$b === "string" && Object.keys(v).length === 1) {
      out[k] = new Uint8Array(Buffer.from(v.$b, "base64"));
    } else if (typeof v === "object" && !Array.isArray(v)) {
      out[k] = deserialize_state(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// node_modules/quico/node_modules/lemon-tls/src/tls_session.js
var DOWNGRADE_SENTINEL_TLS12 = new Uint8Array([68, 79, 87, 78, 71, 82, 68, 1]);
var DOWNGRADE_SENTINEL_TLS11 = new Uint8Array([68, 79, 87, 78, 71, 82, 68, 0]);
var LEMON_DEBUG = typeof process !== "undefined" && process.env && process.env.LEMON_DEBUG === "1";
function dbg(tag, ...args) {
  if (LEMON_DEBUG) console.error("[LEMON " + tag + "]", ...args);
}
function hexPreview(buf, max) {
  if (!buf) return "null";
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let n = Math.min(b.length, max || 32);
  return b.slice(0, n).toString("hex") + (b.length > n ? `... (${b.length} bytes)` : ` (${b.length} bytes)`);
}
function TLSSession(options) {
  if (!(this instanceof TLSSession)) return new TLSSession(options);
  options = options || {};
  const ev = new EventEmitter();
  let context = {
    state: "new",
    //new | negotiating | ...
    isServer: !!options.isServer,
    rejectUnauthorized: options.rejectUnauthorized !== false,
    // default true
    ca: options.ca || null,
    // CA certificates (PEM strings or Buffers)
    SNICallback: options.SNICallback || null,
    ticketKeys: options.ticketKeys || null,
    // 48 bytes: [0:16]=key_name, [16:48]=AES-256-GCM key
    ticketLifetime: options.ticketLifetime != null ? options.ticketLifetime >>> 0 : 7200,
    // seconds
    sessionTickets: options.sessionTickets !== false,
    // default true (was noTickets inverted)
    // Advanced options
    maxHandshakeSize: options.maxHandshakeSize || 0,
    // 0 = no limit
    customExtensions: options.customExtensions || [],
    // [{type:0xNN, data:Uint8Array}]
    handshakeBytes: 0,
    handshakeStartTime: null,
    handshakeEndTime: null,
    rawClientHello: null,
    // saved for JA3/JA4 and 'clienthello' event
    //local stuff...
    local_sni: options.servername || null,
    local_session_id: "sessionId" in options ? options.sessionId : null,
    local_random: null,
    local_extensions: [],
    // DTLS-SRTP protection profiles we accept, in preference order (RFC 5764).
    // Value-based, not key-based: transports forward the option unconditionally,
    // so the key is present with an undefined value when it was never set.
    srtp_profiles: Array.isArray(options.srtpProfiles) ? options.srtpProfiles.slice() : [],
    selected_srtp_profile: null,
    // Extension types we offered — see note_offered_extensions().
    offered_extension_types: [],
    local_supported_versions: [],
    local_supported_alpns: [],
    local_supported_cipher_suites: [],
    local_supported_signature_algorithms: [],
    local_supported_groups: [],
    //remote stuff...
    remote_sni: null,
    remote_session_id: null,
    remote_random: null,
    remote_extensions: [],
    remote_supported_versions: [],
    remote_supported_alpns: [],
    remote_supported_cipher_suites: [],
    remote_supported_signature_algorithms: [],
    remote_supported_groups: [],
    //selected stuff...
    selected_extensions: [],
    selected_sni: null,
    selected_session_id: null,
    // for TLS 1.2 only
    selected_version: null,
    selected_alpn: null,
    selected_cipher_suite: null,
    selected_signature_algorithm: null,
    selected_group: null,
    local_key_groups: {},
    remote_key_groups: {},
    ecdhe_shared_secret: null,
    base_secret: null,
    transcript: [],
    transcriptHook: null,
    // DTLSSession sets this to transform transcript entries
    // Incremental transcript hash — running crypto.Hash object that we update
    // each time a handshake message is pushed. Replaces the previous pattern of
    // `concatUint8Arrays(transcript)` + `hashFn(...)` on every key-derivation
    // step, which re-hashed and re-allocated the entire transcript each time
    // (~5 times per handshake, several KB each).
    //
    // The array `transcript` is still maintained in parallel for cases that
    // need it (HRR rewind, TLS 1.2 EMS snapshot via transcript.length, logging).
    // Only the HASH path uses this incremental object. Reset on HRR.
    transcriptHash: null,
    // crypto.Hash object (lazy init when hashName is known)
    transcriptHashName: null,
    // hash algorithm currently tracked ('sha256' / 'sha384')
    //both
    hello_sent: false,
    finished_sent: false,
    cert_sent: false,
    //1.2 only
    key_exchange_sent: false,
    hello_done_sent: false,
    remote_hello_done: false,
    use_extended_master_secret: false,
    //1.3 only
    encrypted_exts_sent: false,
    cert_verify_sent: false,
    message_sent_seq: 0,
    remote_finished: null,
    expected_remote_finished: null,
    remote_finished_ok: false,
    local_finished_data: null,
    // saved for getFinished()
    remote_finished_data: null,
    // saved for getPeerFinished()
    remote_handshake_traffic_secret: null,
    local_handshake_traffic_secret: null,
    // RFC 8446 §7.1: the application traffic secrets (and exporter_master_secret)
    // are derived from the transcript hash through the SERVER's Finished —
    // ClientHello..server Finished, and nothing after it.
    //
    // This is a SEMANTIC checkpoint, so it is captured at the moment that event
    // happens (server: when it pushes its own Finished; client: when it accepts
    // the server's), NOT read off the live transcript wherever the derivation
    // block happens to sit in the reactive loop. Those two differ: on the
    // client, the loop may already have emitted its own Certificate (when the
    // server requested client auth) before reaching the derivation block, which
    // silently derived app keys over a longer transcript than the server used —
    // a split-key handshake that surfaced only as a late bad_record_mac.
    tls13_app_transcript_hash: null,
    local_app_traffic_secret: null,
    local_cert_chain: null,
    remote_cert_chain: null,
    peerAuthorized: false,
    // Set only after the peer's handshake signature (TLS 1.3
    // CertificateVerify, or TLS 1.2 ServerKeyExchange) actually verified
    // against its certificate's public key. Gates handshake completion.
    peerSignatureVerified: false,
    peerSignatureScheme: null,
    authorizationError: null,
    selected_cert: null,
    cert_private_key: null,
    // Client certificate authentication
    requestCert: !!options.requestCert,
    // server: send CertificateRequest?
    clientCert: options.cert || null,
    // client: cert to send if requested
    clientKey: options.key || null,
    // client: private key for CertificateVerify
    certificateRequested: false,
    // client: server sent CertificateRequest?
    certificateRequestSent: false,
    // server: we sent CertificateRequest?
    certificateRequestContext: null,
    certificateRequestSigAlgs: [],
    clientCertSent: false,
    // HelloRetryRequest
    helloRetried: false,
    // true if HRR was sent/received
    // What a received HelloRetryRequest committed the server to; the second
    // ServerHello is validated against these (RFC 8446 §4.1.4).
    hrr_version: null,
    hrr_group: null,
    hrr_cipher: null,
    // DTLS cookie (set by DTLSSession via set_context)
    dtls_cookie: void 0,
    // Uint8Array or undefined
    // TLS 1.3 resumption
    tls13_master_secret: null,
    exporter_master_secret: null,
    // RFC 8446 §7.1 "exp master" — for exportKeyingMaterial
    resumption_master_secret: null,
    ticket_nonce_counter: 0,
    session_ticket_sent: false,
    psk_offered: null,
    // client: { identity, psk, cipher } offered in ClientHello
    psk_accepted: false,
    // server accepted PSK → abbreviated handshake
    isResumed: false,
    // true if PSK was accepted (1.3) or abbreviated handshake (1.2)
    // TLS 1.2 resumption
    tls12_abbreviated: false,
    // doing abbreviated handshake (server side)
    tls12_resume_state: null,
    // loaded session state (from SessionID or Ticket): { version, cipher, master_secret, extended_master_secret, sni, alpn, timestamp }
    tls12_session_ticket_requested: false,
    // client sent SessionTicket extension (empty or with data)
    tls12_session_ticket_offered: null,
    // client sent non-empty SessionTicket (raw bytes) — server tries to decrypt
    tls12_newsession_sent: false,
    // server sent NewSessionTicket message (TLS 1.2)
    tls12_session_id_for_store: null,
    // session_id to emit with 'newSession' (32 bytes, server-generated)
    tls12_session_id_emitted: false,
    // 'newSession' event already fired
    tls12_client_session_emitted: false,
    // client-side 'session' event fired (TLS 1.2 Session ID or ticket)
    tls12_resume_pending: false,
    // waiting for 'resumeSession' async callback
    tls12_client_session: null
    // client: saved session to resume with (parsed sessionData)
  };
  function _emitKeylogPair(labelClient, labelServer, secretClient, secretServer) {
    if (ev.listenerCount("keylog") === 0) return;
    let clientRandom = context.isServer ? context.remote_random : context.local_random;
    if (!clientRandom) return;
    let crHex = Buffer.from(clientRandom).toString("hex");
    if (secretClient) {
      let line = labelClient + " " + crHex + " " + Buffer.from(secretClient).toString("hex") + "\n";
      ev.emit("keylog", Buffer.from(line));
    }
    if (secretServer) {
      let line = labelServer + " " + crHex + " " + Buffer.from(secretServer).toString("hex") + "\n";
      ev.emit("keylog", Buffer.from(line));
    }
  }
  function _emitHandshakeKeylog() {
    _emitKeylogPair(
      "CLIENT_HANDSHAKE_TRAFFIC_SECRET",
      "SERVER_HANDSHAKE_TRAFFIC_SECRET",
      context.isServer ? context.remote_handshake_traffic_secret : context.local_handshake_traffic_secret,
      context.isServer ? context.local_handshake_traffic_secret : context.remote_handshake_traffic_secret
    );
  }
  function _emitAppKeylog() {
    _emitKeylogPair(
      "CLIENT_TRAFFIC_SECRET_0",
      "SERVER_TRAFFIC_SECRET_0",
      context.isServer ? context.remote_app_traffic_secret : context.local_app_traffic_secret,
      context.isServer ? context.local_app_traffic_secret : context.remote_app_traffic_secret
    );
  }
  function _emitKeylog(label, secret) {
    if (ev.listenerCount("keylog") === 0) return;
    let clientRandom = context.isServer ? context.remote_random : context.local_random;
    if (!clientRandom || !secret) return;
    let line = label + " " + Buffer.from(clientRandom).toString("hex") + " " + Buffer.from(secret).toString("hex") + "\n";
    ev.emit("keylog", Buffer.from(line));
  }
  function is13() {
    return context.selected_version === TLS_VERSION.TLS1_3 || context.selected_version === DTLS_VERSION.DTLS1_3;
  }
  function is12() {
    return context.selected_version === TLS_VERSION.TLS1_2 || context.selected_version === DTLS_VERSION.DTLS1_2;
  }
  function build_client_hello_extensions(opts) {
    opts = opts || {};
    let offers13 = context.local_supported_versions.some(function(v) {
      return v === TLS_VERSION.TLS1_3 || v === DTLS_VERSION.DTLS1_3;
    });
    let tls13Only = context.local_supported_versions.length > 0 && context.local_supported_versions.every(function(v) {
      return v === TLS_VERSION.TLS1_3 || v === DTLS_VERSION.DTLS1_3;
    });
    let extensions = [];
    if (offers13) {
      extensions.push({ type: "SUPPORTED_VERSIONS", value: context.local_supported_versions });
    }
    let advertisable = [];
    for (let gi = 0; gi < context.local_supported_groups.length; gi++) {
      let g = context.local_supported_groups[gi];
      if (is_supported_group(g)) advertisable.push(g);
    }
    extensions.push({ type: "SUPPORTED_GROUPS", value: advertisable });
    if (offers13 && opts.keySharePublic) {
      extensions.push({
        type: "KEY_SHARE",
        value: [{ group: opts.keyShareGroup, key_exchange: opts.keySharePublic }]
      });
    }
    extensions.push({
      type: "SIGNATURE_ALGORITHMS",
      value: context.local_supported_signature_algorithms
    });
    if (!tls13Only) {
      extensions.push({ type: "RENEGOTIATION_INFO", value: new Uint8Array(0) });
      extensions.push({ type: "EXTENDED_MASTER_SECRET", value: null });
    } else {
      extensions.push({ type: "PSK_KEY_EXCHANGE_MODES", value: [1] });
    }
    if (context.local_sni) {
      extensions.unshift({ type: "SERVER_NAME", value: context.local_sni });
    }
    if (context.local_supported_alpns && context.local_supported_alpns.length > 0) {
      extensions.push({ type: "ALPN", value: context.local_supported_alpns });
    }
    let isDtlsProfile = context.local_supported_versions && context.local_supported_versions.some(function(v) {
      return (v & 65280) === 65024;
    });
    if (!isDtlsProfile && !tls13Only && context.sessionTickets) {
      if (opts.sessionTicket) {
        extensions.push({ type: "SESSION_TICKET", value: opts.sessionTicket });
      } else {
        extensions.push({ type: "SESSION_TICKET", value: new Uint8Array(0) });
      }
    }
    if (opts.cookie) {
      extensions.push({ type: "COOKIE", value: opts.cookie });
    }
    if (!context.isServer && Array.isArray(context.srtp_profiles) && context.srtp_profiles.length > 0) {
      extensions.push({
        type: "USE_SRTP",
        value: {
          profiles: context.srtp_profiles.slice(),
          mki: new Uint8Array(0)
        }
      });
    }
    for (let i = 0; i < context.local_extensions.length; i++) {
      extensions.push(context.local_extensions[i]);
    }
    note_offered_extensions(extensions);
    return extensions;
  }
  function reject_unsolicited_extensions(message, where) {
    if (context.isServer) return false;
    if (!Array.isArray(message.extensions)) return false;
    if (context.offered_extension_types.length === 0) return false;
    for (let i = 0; i < message.extensions.length; i++) {
      let et = message.extensions[i] && message.extensions[i].type;
      if (typeof et !== "number") continue;
      if (context.offered_extension_types.indexOf(et) < 0) {
        fatalAlert(
          TLS_ALERT.UNSUPPORTED_EXTENSION,
          where + " carried extension " + et + " which we did not offer"
        );
        return true;
      }
    }
    return false;
  }
  function note_offered_extensions(list) {
    if (!Array.isArray(context.offered_extension_types)) {
      context.offered_extension_types = [];
    }
    for (let i = 0; i < list.length; i++) {
      let t = list[i] && list[i].type;
      let code = typeof t === "number" ? t : TLS_EXT[t];
      if (typeof code === "number" && context.offered_extension_types.indexOf(code) < 0) {
        context.offered_extension_types.push(code);
      }
    }
  }
  function peer_leaf_public_key() {
    if (!context.remote_cert_chain || context.remote_cert_chain.length === 0) return null;
    try {
      return new X509Certificate(Buffer.from(context.remote_cert_chain[0].cert)).publicKey;
    } catch (e) {
      return null;
    }
  }
  function hello_cipher_suite(message) {
    if (Array.isArray(message.cipher_suites) && message.cipher_suites.length > 0) {
      return message.cipher_suites[0];
    }
    if (typeof message.cipher_suite === "number") return message.cipher_suite;
    return null;
  }
  function send_second_client_hello(keyShareGroup, keySharePublic, cookie) {
    let extensions = build_client_hello_extensions({
      keyShareGroup,
      keySharePublic,
      cookie
    });
    let ch2 = build_tls_message({
      type: "client_hello",
      version: 771,
      random: context.local_random,
      session_id: context.local_session_id,
      cookie: context.dtls_cookie,
      cipher_suites: context.local_supported_cipher_suites,
      cipher_suite: context.local_supported_cipher_suites,
      extensions
    });
    pushTranscript(ch2);
    ev.emit("message", 0, context.message_sent_seq, "hello", ch2);
    context.message_sent_seq++;
  }
  function peer_requested_sig_algs() {
    return context.certificateRequestSigAlgs || [];
  }
  function negotiated_hash() {
    let meta = TLS_CIPHER_SUITES[context.selected_cipher_suite];
    return meta ? meta.hash : null;
  }
  function local_private_key() {
    if (!context.cert_private_key) return null;
    return createPrivateKey({
      key: Buffer.from(context.cert_private_key),
      format: "der",
      type: "pkcs8"
    });
  }
  function label_prefix() {
    return context.selected_version === DTLS_VERSION.DTLS1_3 ? LABEL_PREFIX_DTLS13 : LABEL_PREFIX_TLS13;
  }
  function negotiate_srtp_profile() {
    if (!context.isServer) return null;
    if (!Array.isArray(context.srtp_profiles) || context.srtp_profiles.length === 0) return null;
    let offered = null;
    for (let i = 0; i < context.remote_extensions.length; i++) {
      let e = context.remote_extensions[i];
      if (e && e.type === TLS_EXT.USE_SRTP) {
        offered = e.value;
        break;
      }
    }
    if (!offered || !Array.isArray(offered.profiles) || offered.profiles.length === 0) return null;
    for (let i = 0; i < context.srtp_profiles.length; i++) {
      let p = context.srtp_profiles[i] | 0;
      if (offered.profiles.indexOf(p) >= 0) return p;
    }
    return null;
  }
  function pushTranscript(data) {
    if (context.transcriptHook) {
      data = context.transcriptHook(data);
    }
    context.transcript.push(data);
    if (context.transcriptHash !== null) {
      context.transcriptHash.update(data);
    }
  }
  function get_transcript_hash(hashName) {
    if (context.transcriptHash !== null && context.transcriptHashName === hashName) {
      return new Uint8Array(context.transcriptHash.copy().digest());
    }
    context.transcriptHash = createHash(hashName);
    context.transcriptHashName = hashName;
    for (let i = 0; i < context.transcript.length; i++) {
      context.transcriptHash.update(context.transcript[i]);
    }
    return new Uint8Array(context.transcriptHash.copy().digest());
  }
  function reset_transcript_hash(hashName) {
    context.transcriptHash = createHash(hashName);
    context.transcriptHashName = hashName;
    for (let i = 0; i < context.transcript.length; i++) {
      context.transcriptHash.update(context.transcript[i]);
    }
  }
  function fatalAlert(description, msg) {
    if (context.state === "error" || context.state === "closed") return;
    sendAlert(2, description);
    ev.emit("error", new Error(msg));
  }
  function process_income_message(data) {
    if (context.state === "error" || context.state === "closed") return;
    if (context.handshakeStartTime === null) context.handshakeStartTime = Date.now();
    context.handshakeBytes += data.length;
    if (context.maxHandshakeSize > 0 && context.handshakeBytes > context.maxHandshakeSize) {
      fatalAlert(
        TLS_ALERT.INTERNAL_ERROR,
        "Handshake size exceeded maxHandshakeSize (" + context.maxHandshakeSize + ")"
      );
      return;
    }
    let message;
    try {
      message = parse_tls_message(data, context.selected_version);
    } catch (e) {
      fatalAlert(e.alertDesc || TLS_ALERT.DECODE_ERROR, "Malformed handshake message: " + e.message);
      return;
    }
    {
      let t = message.type;
      let serverOnly = t === "server_hello" || t === "encrypted_extensions" || t === "server_hello_done" || t === "certificate_request" || t === "server_key_exchange" || t === "new_session_ticket";
      let clientOnly = t === "client_hello" || t === "client_key_exchange";
      if (context.isServer && serverOnly || !context.isServer && clientOnly) {
        fatalAlert(TLS_ALERT.UNEXPECTED_MESSAGE, "Unexpected " + t + " from " + (context.isServer ? "client" : "server"));
        return;
      }
    }
    ev.emit("handshakeMessage", message.type, data, message);
    if (context.isServer == false && message.type == "server_hello" || context.isServer == true && message.type == "client_hello") {
      if (context.isServer && message.type === "client_hello") {
        let comp = message.legacy_compression || [];
        if (comp.indexOf(0) < 0) {
          fatalAlert(TLS_ALERT.ILLEGAL_PARAMETER, "ClientHello without null compression");
          return;
        }
        let sv = message.supported_versions || [];
        let offers13 = sv.indexOf(TLS_VERSION.TLS1_3) >= 0 || sv.indexOf(DTLS_VERSION.DTLS1_3) >= 0;
        let lv = context.local_supported_versions || [];
        let we13 = lv.length === 0 || lv.indexOf(TLS_VERSION.TLS1_3) >= 0 || lv.indexOf(DTLS_VERSION.DTLS1_3) >= 0;
        if (offers13 && we13 && comp.length !== 1) {
          fatalAlert(TLS_ALERT.ILLEGAL_PARAMETER, "TLS 1.3 ClientHello must offer exactly the null compression method");
          return;
        }
        if (message.pre_shared_key && Array.isArray(message.pre_shared_key.identities)) {
          let nIds = message.pre_shared_key.identities.length;
          let nBinders = Array.isArray(message.pre_shared_key.binders) ? message.pre_shared_key.binders.length : 0;
          if (nIds === 0 || nBinders !== nIds) {
            fatalAlert(TLS_ALERT.ILLEGAL_PARAMETER, "pre_shared_key identities/binders count mismatch (" + nIds + "/" + nBinders + ")");
            return;
          }
        }
      }
      pushTranscript(data);
      if (context.isServer && message.type === "client_hello") {
        context.rawClientHello = data;
        context.remote_extensions = message.extensions || [];
        ev.emit("clienthello", data, message);
      }
      if (Array.isArray(message.extensions)) {
        for (let ei = 0; ei < message.extensions.length; ei++) {
          if (message.extensions[ei].type === 23) {
            context.use_extended_master_secret = true;
            break;
          }
        }
      }
      if (context.isServer && message.pre_shared_key && message.pre_shared_key.identities && message.pre_shared_key.identities.length > 0) {
        let pskIdentity = message.pre_shared_key.identities[0];
        let pskBinder = message.pre_shared_key.binders ? message.pre_shared_key.binders[0] : null;
        dbg(
          "SRV-PSK",
          "received identity:",
          hexPreview(pskIdentity.identity, 24),
          "age:",
          (pskIdentity.age || 0) >>> 0,
          "received binder:",
          hexPreview(pskBinder, 16)
        );
        let pskResult = null;
        ev.emit("psk", {
          identity: pskIdentity.identity,
          obfuscatedAge: (pskIdentity.age || 0) >>> 0
        }, function(result) {
          pskResult = result;
        });
        dbg("SRV-PSK", "pskResult:", pskResult ? `psk=${hexPreview(pskResult.psk, 8)} cipher=0x${pskResult.cipher?.toString(16)}` : "null (decrypt failed)");
        if (pskResult && pskResult.psk) {
          let pskCipher = pskResult.cipher || 4865;
          let hashName = TLS_CIPHER_SUITES[pskCipher] ? TLS_CIPHER_SUITES[pskCipher].hash : "sha256";
          let binder_key = derive_binder_key(hashName, pskResult.psk, false, label_prefix());
          let hashLen = getHashFn(hashName).outputLen;
          let bindersSize = 2 + 1 + hashLen;
          let truncatedCH = data.slice(0, data.length - bindersSize);
          let expectedBinder = compute_psk_binder(hashName, binder_key, truncatedCH, label_prefix());
          dbg(
            "SRV-PSK",
            "hash:",
            hashName,
            "hashLen:",
            hashLen,
            "truncatedCH len:",
            truncatedCH.length,
            "full CH len:",
            data.length
          );
          dbg("SRV-PSK", "expected binder:", hexPreview(expectedBinder, 16));
          dbg("SRV-PSK", "received binder:", hexPreview(pskBinder, 16));
          let binderOk = timingSafeEqualU8(expectedBinder, pskBinder);
          dbg("SRV-PSK", binderOk ? "\u2713 BINDER MATCH \u2014 psk_accepted" : "\u2717 BINDER MISMATCH \u2014 full handshake");
          if (binderOk) {
            context.psk_accepted = true;
            context.isResumed = true;
            context.psk_offered = {
              psk: pskResult.psk instanceof Uint8Array ? pskResult.psk : new Uint8Array(pskResult.psk),
              cipher: pskCipher,
              // The HASH is what actually constrains cipher selection
              // (RFC 8446 §4.2.11), not the exact suite the ticket was issued
              // under. Stored here so selection does not have to re-derive it.
              hash: hashName
            };
          }
        }
      }
      if (!context.isServer && message.pre_shared_key && typeof message.pre_shared_key.selected === "number") {
        if (context.psk_offered) {
          dbg("CLI-PSK", "\u2713 server accepted PSK, selected_identity:", message.pre_shared_key.selected);
          context.psk_accepted = true;
          context.isResumed = true;
        }
      } else if (!context.isServer && context.psk_offered && message.type === "server_hello") {
        dbg("CLI-PSK", "\u2717 server did NOT include pre_shared_key in SH \u2014 full handshake");
      }
      if (!context.isServer && message.random && uint8Equal2(message.random, TLS13_HRR_RANDOM)) {
        context.helloRetried = true;
        let hrrCipher = null;
        if (message.cipher_suites && message.cipher_suites.length > 0) hrrCipher = message.cipher_suites[0];
        else if (message.cipher_suite) hrrCipher = message.cipher_suite;
        if (!hrrCipher) hrrCipher = 4865;
        let hashName = TLS_CIPHER_SUITES[hrrCipher] ? TLS_CIPHER_SUITES[hrrCipher].hash : "sha256";
        let hrrData = context.transcript.pop();
        let ch1_hash = getHashFn(hashName)(concatUint8Arrays2(context.transcript));
        let message_hash = build_message(TLS_MESSAGE_TYPE.MESSAGE_HASH, ch1_hash);
        context.transcript = [message_hash, hrrData];
        reset_transcript_hash(hashName);
        let requestedGroup = null;
        if (message.key_groups && message.key_groups.length > 0) {
          requestedGroup = message.key_groups[0].group;
        } else if (message.supported_groups && message.supported_groups.length > 0) {
          requestedGroup = message.supported_groups[0];
        }
        let hrrCookie = message.cookie || null;
        if (!requestedGroup && !hrrCookie) {
          fatalAlert(
            TLS_ALERT.ILLEGAL_PARAMETER,
            "HelloRetryRequest requests no change (no key_share and no cookie)"
          );
          return;
        }
        let hrrCipherSel = hello_cipher_suite(message);
        if (hrrCipherSel !== null) context.hrr_cipher = hrrCipherSel;
        let hrrVersionSel = null;
        if (Array.isArray(message.supported_versions) && message.supported_versions.length > 0) {
          hrrVersionSel = message.supported_versions[0];
        } else if (typeof message.supported_versions === "number") {
          hrrVersionSel = message.supported_versions;
        }
        if (hrrVersionSel !== null) context.hrr_version = hrrVersionSel;
        context.hrr_group = requestedGroup;
        if (!requestedGroup && hrrCookie) {
          set_context({
            selected_version: Array.isArray(message.supported_versions) && message.supported_versions.length > 0 ? message.supported_versions[0] : typeof message.supported_versions === "number" ? message.supported_versions : null
            // NOTE: dtls_cookie is the DTLS ClientHello's own cookie FIELD
            // (RFC 6347 §4.2.1), which lives in the message body and makes
            // wire.js encode the hello in DTLS framing. The HelloRetryRequest
            // cookie is a completely different thing — a TLS EXTENSION
            // (RFC 8446 §4.2.2) that build_client_hello_extensions already
            // carries. They share a name and nothing else. Assigning the HRR
            // cookie here injected a 1-byte length plus the cookie into a TLS
            // ClientHello body, which strict peers reject outright ("error
            // decoding ClientHello message"). Leave the DTLS field alone.
          });
          let firstGroup = context.local_supported_groups[0];
          let firstShare = context.local_key_groups[firstGroup] ? context.local_key_groups[firstGroup].public_key : null;
          send_second_client_hello(firstGroup, firstShare, hrrCookie);
          return;
        }
        if (requestedGroup) {
          if (requestedGroup in context.local_key_groups) {
            fatalAlert(
              TLS_ALERT.ILLEGAL_PARAMETER,
              "HelloRetryRequest asked for group 0x" + (requestedGroup >>> 0).toString(16) + " for which we already sent a key share"
            );
            return;
          }
          if (context.local_supported_groups.length > 0 && context.local_supported_groups.indexOf(requestedGroup) < 0) {
            fatalAlert(
              TLS_ALERT.ILLEGAL_PARAMETER,
              "HelloRetryRequest asked for group 0x" + (requestedGroup >>> 0).toString(16) + " which we did not offer"
            );
            return;
          }
          let newKeyGroup = null;
          let hrrKp = generate_keypair(requestedGroup);
          if (hrrKp) {
            newKeyGroup = { group: requestedGroup, public_key: hrrKp.public_key, private_key: hrrKp.private_key };
            context.local_key_groups[requestedGroup] = { public_key: hrrKp.public_key, private_key: hrrKp.private_key };
          } else {
            fatalAlert(
              TLS_ALERT.ILLEGAL_PARAMETER,
              "HelloRetryRequest asked for unsupported group 0x" + (requestedGroup >>> 0).toString(16)
            );
            return;
          }
          if (newKeyGroup) {
            let hrrVersion = null;
            if (Array.isArray(message.supported_versions) && message.supported_versions.length > 0) {
              hrrVersion = message.supported_versions[0];
            } else if (typeof message.supported_versions === "number") {
              hrrVersion = message.supported_versions;
            }
            set_context({
              selected_version: hrrVersion,
              selected_group: requestedGroup,
              // See the note above: the HRR cookie is an extension, not the
              // DTLS ClientHello cookie field. Preserve whatever DTLS cookie
              // the transport established, and nothing more.
              dtls_cookie: context.dtls_cookie,
              add_local_key_groups: [{
                group: requestedGroup,
                private_key: newKeyGroup.private_key,
                public_key: newKeyGroup.public_key
              }]
            });
            send_second_client_hello(requestedGroup, newKeyGroup.public_key, hrrCookie);
          }
        }
        return;
      }
      let sh_is_13 = false;
      if (Array.isArray(message.supported_versions)) {
        sh_is_13 = message.supported_versions.indexOf(TLS_VERSION.TLS1_3) >= 0 || message.supported_versions.indexOf(DTLS_VERSION.DTLS1_3) >= 0;
      } else if (typeof message.supported_versions === "number") {
        sh_is_13 = message.supported_versions === TLS_VERSION.TLS1_3 || message.supported_versions === DTLS_VERSION.DTLS1_3;
      }
      if (!context.isServer && message.type === "server_hello" && context.helloRetried) {
        if (context.hrr_version !== null) {
          let shVersion = null;
          if (Array.isArray(message.supported_versions) && message.supported_versions.length > 0) {
            shVersion = message.supported_versions[0];
          } else if (typeof message.supported_versions === "number") {
            shVersion = message.supported_versions;
          }
          if (shVersion !== null && shVersion !== context.hrr_version) {
            fatalAlert(
              TLS_ALERT.ILLEGAL_PARAMETER,
              "Second ServerHello version 0x" + (shVersion >>> 0).toString(16) + " does not match the HelloRetryRequest (0x" + (context.hrr_version >>> 0).toString(16) + ")"
            );
            return;
          }
        }
        let shCipherSel = hello_cipher_suite(message);
        if (context.hrr_cipher !== null && shCipherSel !== null && shCipherSel !== context.hrr_cipher) {
          fatalAlert(
            TLS_ALERT.ILLEGAL_PARAMETER,
            "ServerHello cipher suite 0x" + (shCipherSel >>> 0).toString(16) + " differs from the HelloRetryRequest (0x" + (context.hrr_cipher >>> 0).toString(16) + ")"
          );
          return;
        }
        if (context.hrr_group !== null && Array.isArray(message.key_groups) && message.key_groups.length > 0) {
          let shGroup = message.key_groups[0] && message.key_groups[0].group;
          if (typeof shGroup === "number" && shGroup !== context.hrr_group) {
            fatalAlert(
              TLS_ALERT.ILLEGAL_PARAMETER,
              "Second ServerHello selected group 0x" + (shGroup >>> 0).toString(16) + " but the HelloRetryRequest asked for 0x" + (context.hrr_group >>> 0).toString(16)
            );
            return;
          }
        }
      }
      if (!context.isServer && Array.isArray(message.extensions)) {
        for (let sx = 0; sx < message.extensions.length; sx++) {
          let e = message.extensions[sx];
          if (e && e.type === TLS_EXT.USE_SRTP && e.value && Array.isArray(e.value.profiles) && e.value.profiles.length > 0) {
            context.selected_srtp_profile = e.value.profiles[0];
          }
        }
      }
      if (sh_is_13 && reject_unsolicited_extensions(message, "ServerHello")) return;
      if (sh_is_13 && !context.isServer && message.type === "server_hello") {
        let sentSid = context.local_session_id || new Uint8Array(0);
        let echoSid = message.session_id || new Uint8Array(0);
        let sameSid = sentSid.length === echoSid.length;
        if (sameSid) {
          for (let si = 0; si < sentSid.length; si++) {
            if (sentSid[si] !== echoSid[si]) {
              sameSid = false;
              break;
            }
          }
        }
        if (!sameSid) {
          fatalAlert(
            TLS_ALERT.ILLEGAL_PARAMETER,
            "ServerHello legacy_session_id_echo does not match the ClientHello (sent " + sentSid.length + " bytes, echoed " + echoSid.length + ")"
          );
          return;
        }
      }
      if (!context.isServer && message.type === "server_hello" && sh_is_13 && Array.isArray(message.key_groups) && message.key_groups.length > 0) {
        for (let ki = 0; ki < message.key_groups.length; ki++) {
          let g = message.key_groups[ki] && message.key_groups[ki].group;
          if (typeof g !== "number") continue;
          if (!(g in context.local_key_groups)) {
            fatalAlert(
              TLS_ALERT.ILLEGAL_PARAMETER,
              "ServerHello selected key_share group 0x" + (g >>> 0).toString(16) + " for which we sent no key share"
            );
            return;
          }
        }
      }
      if (context.isServer === true && message.type === "client_hello" && typeof context.SNICallback === "function") {
        context.SNICallback(message.sni || null, function(err, creds) {
          if (!err && creds) {
            context.local_cert_chain = creds.certificateChain;
            context.cert_private_key = creds.privateKey;
          }
        });
      }
      set_context({
        remote_random: message.random || null,
        remote_sni: message.sni || null,
        remote_session_id: message.session_id || null,
        remote_supported_versions: message.supported_versions && message.supported_versions.length > 0 ? message.supported_versions : message.legacy_version ? [message.legacy_version] : [],
        remote_supported_alpns: message.alpn || [],
        remote_supported_cipher_suites: message.cipher_suites || [],
        remote_supported_signature_algorithms: message.signature_algorithms || [],
        remote_supported_groups: message.supported_groups || [],
        remote_extensions: message.extensions || [],
        add_remote_key_groups: message.key_groups || []
      });
      if (!context.isServer && message.type === "server_hello" && context.local_supported_versions.indexOf(TLS_VERSION.TLS1_3) >= 0 && context.selected_version !== null && context.selected_version !== TLS_VERSION.TLS1_3 && context.selected_version !== DTLS_VERSION.DTLS1_3 && message.random && message.random.length === 32) {
        let tail = message.random.subarray(24, 32);
        if (timingSafeEqualU8(tail, DOWNGRADE_SENTINEL_TLS12) || timingSafeEqualU8(tail, DOWNGRADE_SENTINEL_TLS11)) {
          dbg("DOWNGRADE", "sentinel detected in ServerHello.random \u2014 aborting");
          fatalAlert(
            TLS_ALERT.ILLEGAL_PARAMETER,
            "TLS downgrade attack detected (RFC 8446 \xA74.1.3 sentinel present)"
          );
          return;
        }
      }
      if (context.isServer && message.type === "client_hello") {
        if (message.session_ticket_supported) {
          context.tls12_session_ticket_requested = true;
        }
        if (message.session_ticket && message.session_ticket.length > 0 && context.ticketKeys && context.sessionTickets) {
          let state = decrypt_session_blob(message.session_ticket, context.ticketKeys);
          if (state && state.v === 12 && state.master_secret) {
            context.tls12_resume_state = state;
            context.tls12_session_ticket_offered = message.session_ticket;
          }
        }
        if (!context.tls12_resume_state && message.session_id && message.session_id.length > 0) {
          let offeredId = message.session_id;
          let resolved = false;
          let resumeCb = function(err, sessionData) {
            if (resolved) return;
            resolved = true;
            context.tls12_resume_pending = false;
            if (!err && sessionData) {
              let state = null;
              if (sessionData instanceof Uint8Array || Buffer.isBuffer(sessionData)) {
                state = decrypt_session_blob(sessionData, context.ticketKeys);
              } else if (typeof sessionData === "object" && sessionData.master_secret) {
                state = sessionData;
              }
              if (state && state.v === 12 && state.master_secret) {
                set_context({
                  tls12_resume_state: state
                });
              }
            }
          };
          context.tls12_resume_pending = true;
          ev.emit("resumeSession", offeredId, resumeCb);
          if (ev.listenerCount("resumeSession") === 0) {
            resumeCb(null, null);
          }
        }
      }
      if (!context.isServer && context.tls12_client_session && message.type === "server_hello" && message.session_id && message.session_id.length > 0) {
        let abbreviatedDetected = false;
        let savedSid = context.tls12_client_session.session_id;
        let sentSid = context.local_session_id;
        let hasTicket = context.tls12_client_session.ticket && context.tls12_client_session.ticket.length > 0;
        dbg(
          "CLI-12RESUME",
          "saved sid:",
          hexPreview(savedSid, 16),
          "sent sid:",
          hexPreview(sentSid, 16),
          "received sid:",
          hexPreview(message.session_id, 16),
          "hasTicket:",
          hasTicket
        );
        if (savedSid && savedSid.length > 0 && uint8Equal2(message.session_id, savedSid)) {
          abbreviatedDetected = true;
          dbg("CLI-12RESUME", "\u2713 case (a) matched: SH echoes saved sid");
        }
        if (!abbreviatedDetected && hasTicket && sentSid && sentSid.length > 0 && uint8Equal2(message.session_id, sentSid)) {
          abbreviatedDetected = true;
          dbg("CLI-12RESUME", "\u2713 case (b) matched: SH echoes CH sid after ticket offer");
        }
        if (!abbreviatedDetected) {
          dbg("CLI-12RESUME", "\u2717 no match \u2014 full handshake expected");
        }
        if (abbreviatedDetected) {
          context.tls12_abbreviated = true;
          context.isResumed = true;
          set_context({
            base_secret: context.tls12_client_session.master_secret,
            use_extended_master_secret: !!context.tls12_client_session.extended_master_secret,
            // Mark as if remote_hello_done arrived — we won't actually receive it in abbreviated flow,
            // but the reactive loop uses this to gate CKE; we're skipping CKE anyway.
            remote_hello_done: true,
            // Pretend key_exchange_sent so Finished logic proceeds without real CKE
            key_exchange_sent: true
          });
        }
      }
      ev.emit("hello");
    } else if (message.type == "client_key_exchange" || message.type == "server_key_exchange") {
      pushTranscript(data);
      if (message.type === "server_key_exchange" && !context.isServer && message.signature && message.public_key) {
        if (!context.remote_cert_chain || context.remote_cert_chain.length === 0) {
          fatalAlert(TLS_ALERT.UNEXPECTED_MESSAGE, "ServerKeyExchange before Certificate");
          return;
        }
        let skePubKey = peer_leaf_public_key();
        if (!skePubKey) {
          fatalAlert(TLS_ALERT.BAD_CERTIFICATE, "Cannot read server certificate public key");
          return;
        }
        let ecdhParams = build_server_ecdh_params(message.group, message.public_key);
        let skeTbs = concatUint8Arrays2([
          context.local_random,
          // client_random (we are the client)
          context.remote_random,
          // server_random
          ecdhParams
        ]);
        let skeOk = verify_with_scheme(
          TLS_VERSION.TLS1_2,
          message.sig_alg,
          skeTbs,
          skePubKey,
          message.signature
        );
        if (skeOk !== true) {
          fatalAlert(TLS_ALERT.DECRYPT_ERROR, "ServerKeyExchange signature verification failed");
          return;
        }
        context.peerSignatureVerified = true;
        context.peerSignatureScheme = message.sig_alg;
      }
      if ([49199, 49195, 49200, 49196, 49171, 49172, 49161, 49162].includes(context.selected_cipher_suite) == true) {
        let kex_group = message.group || context.selected_group;
        let kex_updates = {
          add_remote_key_groups: [
            {
              group: kex_group,
              public_key: message.public_key
            }
          ]
        };
        if (context.selected_group === null && kex_group) {
          kex_updates.selected_group = kex_group;
        }
        set_context(kex_updates);
      } else if ([158, 159, 51, 57, 103, 107].includes(context.selected_cipher_suite) == true) {
        let client_dh_y = message.body.slice(2);
      } else if ([47, 53, 60, 61, 5, 10].includes(context.selected_cipher_suite) == true) {
        let enc_pms = message.body.slice(2);
      } else if ([49156, 49157, 49163, 49164].includes(context.selected_cipher_suite) == true) {
      }
    } else if (message.type == "server_hello_done") {
      pushTranscript(data);
      set_context({
        remote_hello_done: true
      });
    } else if (message.type == "encrypted_extensions") {
      if (reject_unsolicited_extensions(message, "EncryptedExtensions")) return;
      {
        let forbiddenInEE = {
          5: 1,
          // status_request (CH/CR/Certificate only)
          13: 1,
          // signature_algorithms
          21: 1,
          // padding (CH only)
          23: 1,
          // extended_master_secret (not a TLS 1.3 extension)
          35: 1,
          // session_ticket (not a TLS 1.3 extension)
          41: 1,
          // pre_shared_key
          43: 1,
          // supported_versions
          44: 1,
          // cookie
          45: 1,
          // psk_key_exchange_modes
          47: 1,
          // certificate_authorities (CH/CR only)
          50: 1,
          // signature_algorithms_cert
          51: 1,
          // key_share
          65281: 1
          // renegotiation_info (not a TLS 1.3 extension)
        };
        let eeExts = Array.isArray(message.extensions) ? message.extensions : [];
        for (let fi = 0; fi < eeExts.length; fi++) {
          if (eeExts[fi] && forbiddenInEE[eeExts[fi].type] === 1) {
            fatalAlert(TLS_ALERT.ILLEGAL_PARAMETER, "Forbidden extension " + eeExts[fi].type + " in EncryptedExtensions");
            return;
          }
        }
      }
      pushTranscript(data);
      if (Array.isArray(message.extensions) && message.extensions.length > 0) {
        var _mergedExts = (context.remote_extensions || []).slice();
        for (var _eei = 0; _eei < message.extensions.length; _eei++) {
          var _ee = message.extensions[_eei];
          if (!_ee) continue;
          var _dup = false;
          for (var _mj = 0; _mj < _mergedExts.length; _mj++) {
            if (_mergedExts[_mj] && _mergedExts[_mj].type === _ee.type) {
              _dup = true;
              break;
            }
          }
          if (!_dup) _mergedExts.push(_ee);
        }
        context.remote_extensions = _mergedExts;
      }
      set_context({
        remote_supported_groups: message.supported_groups || []
      });
    } else if (message.type == "certificate") {
      pushTranscript(data);
      let entries = message.entries || [];
      if (entries.length === 0) {
        if (!context.isServer) {
          fatalAlert(TLS_ALERT.DECODE_ERROR, "Server sent an empty certificate_list");
          return;
        }
        context.authorizationError = "NO_PEER_CERTIFICATE";
        context.peerAuthorized = false;
        set_context({ remote_cert_chain: [] });
      } else {
        set_context({
          remote_cert_chain: entries
        });
        validatePeerCertificate();
        if (context.rejectUnauthorized && !context.peerAuthorized) {
          fatalAlert(
            TLS_ALERT.BAD_CERTIFICATE,
            "Peer certificate validation failed: " + (context.authorizationError || "unknown")
          );
          return;
        }
      }
    } else if (message.type == "certificate_verify") {
      if (context.selected_version === TLS_VERSION.TLS1_3 || context.selected_version === DTLS_VERSION.DTLS1_3) {
        if (context.selected_cipher_suite === null) {
          fatalAlert(
            TLS_ALERT.UNEXPECTED_MESSAGE,
            "CertificateVerify received before a cipher suite was negotiated"
          );
          return;
        }
        if (!context.remote_cert_chain || context.remote_cert_chain.length === 0) {
          fatalAlert(TLS_ALERT.UNEXPECTED_MESSAGE, "CertificateVerify without a preceding Certificate");
          return;
        }
        let peerPubKey = peer_leaf_public_key();
        if (!peerPubKey) {
          fatalAlert(TLS_ALERT.BAD_CERTIFICATE, "Cannot read peer certificate public key");
          return;
        }
        let cvHashName = negotiated_hash();
        let signerIsServer = !context.isServer;
        let tbs = build_cert_verify_tbs_with_hash(cvHashName, signerIsServer, get_transcript_hash(cvHashName));
        let sigOk = verify_with_scheme(
          TLS_VERSION.TLS1_3,
          // DTLS 1.3 shares TLS 1.3 scheme semantics
          message.scheme,
          tbs,
          peerPubKey,
          message.signature
        );
        if (sigOk !== true) {
          fatalAlert(TLS_ALERT.DECRYPT_ERROR, "CertificateVerify signature verification failed");
          return;
        }
        context.peerSignatureVerified = true;
        context.peerSignatureScheme = message.scheme;
      }
      pushTranscript(data);
    } else if (message.type == "finished") {
      if (is13() && context.remote_cert_chain && context.remote_cert_chain.length > 0 && context.peerSignatureVerified !== true) {
        fatalAlert(
          TLS_ALERT.UNEXPECTED_MESSAGE,
          "Finished received after a certificate that was never proved by a CertificateVerify"
        );
        return;
      }
      set_context({
        remote_finished: message.body
      });
    } else if (message.type == "new_session_ticket") {
      if (!context.isServer) {
        if (is13() && context.resumption_master_secret) {
          let hashName = negotiated_hash();
          let psk = derive_psk(hashName, context.resumption_master_secret, message.ticket_nonce, label_prefix());
          dbg(
            "CLI-NST",
            "received TLS 1.3 NST \u2014 cipher:",
            "0x" + context.selected_cipher_suite.toString(16),
            "hash:",
            hashName,
            "transcript len:",
            concatUint8Arrays2(context.transcript).length
          );
          dbg(
            "CLI-NST",
            "ticket_nonce:",
            hexPreview(message.ticket_nonce, 4),
            "age_add:",
            message.ticket_age_add,
            "lifetime:",
            message.ticket_lifetime
          );
          dbg(
            "CLI-NST",
            "resumption_master_secret:",
            hexPreview(context.resumption_master_secret, 8),
            "derived psk:",
            hexPreview(psk, 8)
          );
          let session_blob = encode_client_session({
            v: 13,
            // blob kind: TLS 1.3
            version: context.selected_version,
            cipher: context.selected_cipher_suite,
            ticket: message.ticket,
            psk,
            age_add: message.ticket_age_add,
            lifetime: message.ticket_lifetime,
            sni: context.local_sni || null,
            alpn: context.selected_alpn || null,
            created: Date.now()
          });
          ev.emit("session", session_blob);
        } else if (context.selected_version === TLS_VERSION.TLS1_2 && context.base_secret) {
          pushTranscript(data);
          context.tls12_received_ticket = message.ticket;
          let session_blob = encode_client_session({
            v: 12,
            // blob kind: TLS 1.2
            version: context.selected_version,
            cipher: context.selected_cipher_suite,
            master_secret: context.base_secret,
            extended_master_secret: !!context.use_extended_master_secret,
            ticket: message.ticket,
            session_id: context.remote_session_id || null,
            // store for Session ID fallback
            lifetime: message.ticket_lifetime_hint || context.ticketLifetime,
            sni: context.local_sni || null,
            alpn: context.selected_alpn || null,
            created: Date.now()
          });
          ev.emit("session", session_blob);
          context.tls12_client_session_emitted = true;
        }
      }
    } else if (message.type == "key_update") {
      if (context.state === "connected" && is13()) {
        let hashName = negotiated_hash();
        let hashLen = getHashLen(hashName);
        let newRemoteSecret = hkdf_expand_label(hashName, context.remote_app_traffic_secret, "traffic upd", new Uint8Array(0, label_prefix()), hashLen);
        context.remote_app_traffic_secret = newRemoteSecret;
        ev.emit("keyUpdate", { direction: "receive", secret: newRemoteSecret });
        if (message.request_update === 1) {
          let newLocalSecret = hkdf_expand_label(hashName, context.local_app_traffic_secret, "traffic upd", new Uint8Array(0, label_prefix()), hashLen);
          context.local_app_traffic_secret = newLocalSecret;
          let ku_data = build_tls_message({ type: "key_update", request_update: 0 });
          ev.emit("message", 2, context.message_sent_seq, "key_update", ku_data);
          context.message_sent_seq++;
          ev.emit("keyUpdate", { direction: "send", secret: newLocalSecret });
        }
      }
    } else if (message.type == "certificate_request") {
      if (!context.isServer) {
        pushTranscript(data);
        context.certificateRequested = true;
        context.certificateRequestContext = message.certificate_request_context || new Uint8Array(0);
        context.certificateRequestSigAlgs = message.signature_algorithms || [];
        ev.emit("certificateRequest", message);
      }
    } else {
      fatalAlert(
        TLS_ALERT.UNEXPECTED_MESSAGE,
        "Unexpected handshake message type " + (message.handshake_type !== void 0 ? message.handshake_type : message.type)
      );
      return;
    }
  }
  function set_context(options2) {
    if (context.state === "error" || context.state === "closed") return;
    let has_changed = false;
    if (options2 && typeof options2 === "object") {
      if ("local_supported_versions" in options2) {
        if (arraysEqual(options2.local_supported_versions, context.local_supported_versions) == false) {
          context.local_supported_versions = options2.local_supported_versions;
          has_changed = true;
        }
      }
      if ("local_supported_cipher_suites" in options2) {
        if (arraysEqual(options2.local_supported_cipher_suites, context.local_supported_cipher_suites) == false) {
          context.local_supported_cipher_suites = options2.local_supported_cipher_suites;
          has_changed = true;
        }
      }
      if ("local_supported_alpns" in options2) {
        if (arraysEqual(options2.local_supported_alpns, context.local_supported_alpns) == false) {
          context.local_supported_alpns = options2.local_supported_alpns;
          has_changed = true;
        }
      }
      if ("local_supported_groups" in options2) {
        if (arraysEqual(options2.local_supported_groups, context.local_supported_groups) == false) {
          context.local_supported_groups = options2.local_supported_groups;
          has_changed = true;
        }
      }
      if ("local_supported_signature_algorithms" in options2) {
        if (arraysEqual(options2.local_supported_signature_algorithms, context.local_supported_signature_algorithms) == false) {
          context.local_supported_signature_algorithms = options2.local_supported_signature_algorithms;
          has_changed = true;
        }
      }
      if ("local_extensions" in options2) {
        if (arraysEqual(options2.local_extensions, context.local_extensions) == false) {
          context.local_extensions = options2.local_extensions;
          has_changed = true;
        }
      }
      if ("remote_supported_versions" in options2) {
        if (arraysEqual(options2.remote_supported_versions, context.remote_supported_versions) == false) {
          context.remote_supported_versions = options2.remote_supported_versions;
          has_changed = true;
        }
      }
      if ("remote_supported_cipher_suites" in options2) {
        if (arraysEqual(options2.remote_supported_cipher_suites, context.remote_supported_cipher_suites) == false) {
          context.remote_supported_cipher_suites = options2.remote_supported_cipher_suites;
          has_changed = true;
        }
      }
      if ("remote_supported_alpns" in options2) {
        if (arraysEqual(options2.remote_supported_alpns, context.remote_supported_alpns) == false) {
          context.remote_supported_alpns = options2.remote_supported_alpns;
          has_changed = true;
        }
      }
      if ("remote_supported_groups" in options2) {
        if (arraysEqual(options2.remote_supported_groups, context.remote_supported_groups) == false) {
          context.remote_supported_groups = options2.remote_supported_groups;
          has_changed = true;
        }
      }
      if ("remote_supported_signature_algorithms" in options2) {
        if (arraysEqual(options2.remote_supported_signature_algorithms, context.remote_supported_signature_algorithms) == false) {
          context.remote_supported_signature_algorithms = options2.remote_supported_signature_algorithms;
          has_changed = true;
        }
      }
      if ("remote_extensions" in options2) {
        if (arraysEqual(options2.remote_extensions, context.remote_extensions) == false) {
          context.remote_extensions = options2.remote_extensions;
          has_changed = true;
        }
      }
      if ("remote_sni" in options2) {
        if (options2.remote_sni !== context.remote_sni) {
          context.remote_sni = options2.remote_sni;
          has_changed = true;
        }
      }
      if ("remote_session_id" in options2) {
        if (!uint8Equal2(options2.remote_session_id, context.remote_session_id)) {
          context.remote_session_id = options2.remote_session_id;
          has_changed = true;
        }
      }
      if ("remote_random" in options2) {
        if (!uint8Equal2(options2.remote_random, context.remote_random)) {
          context.remote_random = options2.remote_random;
          has_changed = true;
        }
      }
      if ("add_local_key_groups" in options2) {
        for (let i = 0; i < options2["add_local_key_groups"].length; i++) {
          let group = options2["add_local_key_groups"][i].group;
          if (group in context.local_key_groups == false) {
            context.local_key_groups[group] = {
              public_key: null,
              private_key: null
            };
            has_changed = true;
          }
          if (context.local_key_groups[group].public_key == null && options2["add_local_key_groups"][i].public_key !== null) {
            context.local_key_groups[group].public_key = options2["add_local_key_groups"][i].public_key;
            has_changed = true;
          }
          if (context.local_key_groups[group].private_key == null && options2["add_local_key_groups"][i].private_key !== null) {
            context.local_key_groups[group].private_key = options2["add_local_key_groups"][i].private_key;
            has_changed = true;
            if (context.local_supported_groups.indexOf(Number(group)) < 0) {
              context.local_supported_groups.push(Number(group));
            }
          }
        }
      }
      if ("add_remote_key_groups" in options2) {
        for (let i = 0; i < options2["add_remote_key_groups"].length; i++) {
          let group = options2["add_remote_key_groups"][i].group;
          if (group in context.remote_key_groups == false) {
            context.remote_key_groups[group] = {
              public_key: null
            };
            has_changed = true;
          }
          if (context.remote_key_groups[group].public_key == null && options2["add_remote_key_groups"][i].public_key !== null) {
            context.remote_key_groups[group].public_key = options2["add_remote_key_groups"][i].public_key;
            has_changed = true;
            if (context.remote_supported_groups.indexOf(Number(group)) < 0) {
              context.remote_supported_groups.push(Number(group));
            }
          }
        }
      }
      if ("remote_cert_chain" in options2) {
        if (context.remote_cert_chain == null || arraysEqual(options2.remote_cert_chain, context.remote_cert_chain) == false) {
          context.remote_cert_chain = options2.remote_cert_chain;
          has_changed = true;
        }
      }
      if ("remote_hello_done" in options2) {
        if (options2.remote_hello_done !== context.remote_hello_done) {
          context.remote_hello_done = options2.remote_hello_done;
          has_changed = true;
        }
      }
      if ("key_exchange_sent" in options2) {
        if (options2.key_exchange_sent !== context.key_exchange_sent) {
          context.key_exchange_sent = options2.key_exchange_sent;
          has_changed = true;
        }
      }
      if ("selected_version" in options2) {
        if (options2.selected_version !== context.selected_version) {
          context.selected_version = options2.selected_version;
          has_changed = true;
        }
      }
      if ("selected_cipher_suite" in options2) {
        if (options2.selected_cipher_suite !== context.selected_cipher_suite) {
          context.selected_cipher_suite = options2.selected_cipher_suite;
          has_changed = true;
        }
      }
      if ("selected_alpn" in options2) {
        if (options2.selected_alpn !== context.selected_alpn) {
          context.selected_alpn = options2.selected_alpn;
          has_changed = true;
        }
      }
      if ("selected_group" in options2) {
        if (options2.selected_group !== context.selected_group) {
          context.selected_group = options2.selected_group;
          has_changed = true;
        }
      }
      if ("selected_signature_algorithm" in options2) {
        if (options2.selected_signature_algorithm !== context.selected_signature_algorithm) {
          context.selected_signature_algorithm = options2.selected_signature_algorithm;
          has_changed = true;
        }
      }
      if ("selected_extensions" in options2) {
        if (arraysEqual(options2.selected_extensions, context.selected_extensions) == false) {
          context.selected_extensions = options2.selected_extensions;
          has_changed = true;
        }
      }
      if ("selected_sni" in options2) {
        if (options2.selected_sni !== context.selected_sni) {
          context.selected_sni = options2.selected_sni;
          has_changed = true;
        }
      }
      if ("selected_session_id" in options2) {
        if (!uint8Equal2(options2.selected_session_id, context.selected_session_id)) {
          context.selected_session_id = options2.selected_session_id;
          has_changed = true;
        }
      }
      if ("tls12_resume_state" in options2) {
        if (context.tls12_resume_state !== options2.tls12_resume_state) {
          context.tls12_resume_state = options2.tls12_resume_state;
          has_changed = true;
        }
      }
      if ("tls12_abbreviated" in options2) {
        if (context.tls12_abbreviated !== options2.tls12_abbreviated) {
          context.tls12_abbreviated = options2.tls12_abbreviated;
          has_changed = true;
        }
      }
      if ("isResumed" in options2) {
        if (context.isResumed !== options2.isResumed) {
          context.isResumed = options2.isResumed;
          has_changed = true;
        }
      }
      if ("use_extended_master_secret" in options2) {
        if (context.use_extended_master_secret !== options2.use_extended_master_secret) {
          context.use_extended_master_secret = options2.use_extended_master_secret;
          has_changed = true;
        }
      }
      if ("ecdhe_shared_secret" in options2) {
        if (context.ecdhe_shared_secret == null && options2.ecdhe_shared_secret !== null) {
          context.ecdhe_shared_secret = options2.ecdhe_shared_secret;
          has_changed = true;
        }
      }
      if ("base_secret" in options2) {
        if (options2.base_secret !== context.base_secret) {
          context.base_secret = options2.base_secret;
          has_changed = true;
          if (options2.base_secret && (context.selected_version === TLS_VERSION.TLS1_2 || context.selected_version === DTLS_VERSION.DTLS1_2)) {
            _emitKeylog("CLIENT_RANDOM", options2.base_secret);
          }
        }
      }
      if ("exporter_master_secret" in options2) {
        if (context.exporter_master_secret == null && options2.exporter_master_secret !== null) {
          context.exporter_master_secret = options2.exporter_master_secret;
        }
      }
      if ("tls13_master_secret" in options2) {
        if (context.tls13_master_secret == null && options2.tls13_master_secret !== null) {
          context.tls13_master_secret = options2.tls13_master_secret;
          has_changed = true;
        }
      }
      if ("remote_handshake_traffic_secret" in options2) {
        if (context.remote_handshake_traffic_secret == null && options2.remote_handshake_traffic_secret !== null) {
          context.remote_handshake_traffic_secret = options2.remote_handshake_traffic_secret;
          has_changed = true;
          if (context.local_handshake_traffic_secret !== null) {
            ev.emit("handshakeSecrets", context.local_handshake_traffic_secret, context.remote_handshake_traffic_secret);
            _emitHandshakeKeylog();
          }
        }
      }
      if ("local_handshake_traffic_secret" in options2) {
        if (context.local_handshake_traffic_secret == null && options2.local_handshake_traffic_secret !== null) {
          context.local_handshake_traffic_secret = options2.local_handshake_traffic_secret;
          has_changed = true;
          if (context.remote_handshake_traffic_secret !== null) {
            ev.emit("handshakeSecrets", context.local_handshake_traffic_secret, context.remote_handshake_traffic_secret);
            _emitHandshakeKeylog();
          }
        }
      }
      if ("remote_app_traffic_secret" in options2) {
        if (context.remote_app_traffic_secret == null && options2.remote_app_traffic_secret !== null) {
          context.remote_app_traffic_secret = options2.remote_app_traffic_secret;
          has_changed = true;
          if (context.local_app_traffic_secret !== null) {
            ev.emit("appSecrets", context.local_app_traffic_secret, context.remote_app_traffic_secret);
            _emitAppKeylog();
          }
        }
      }
      if ("local_app_traffic_secret" in options2) {
        if (context.local_app_traffic_secret == null && options2.local_app_traffic_secret !== null) {
          context.local_app_traffic_secret = options2.local_app_traffic_secret;
          has_changed = true;
          if (context.remote_app_traffic_secret !== null) {
            ev.emit("appSecrets", context.local_app_traffic_secret, context.remote_app_traffic_secret);
            _emitAppKeylog();
          }
        }
      }
      if ("local_cert_chain" in options2) {
        if (context.local_cert_chain == null && options2.local_cert_chain !== null) {
          context.local_cert_chain = options2.local_cert_chain;
          has_changed = true;
        }
      }
      if ("cert_private_key" in options2) {
        if (context.cert_private_key == null && options2.cert_private_key !== null) {
          context.cert_private_key = options2.cert_private_key;
          has_changed = true;
        }
      }
      if ("expected_remote_finished" in options2) {
        if (context.expected_remote_finished == null && options2.expected_remote_finished !== null) {
          context.expected_remote_finished = options2.expected_remote_finished;
          has_changed = true;
        }
      }
      if ("remote_finished" in options2) {
        if (context.remote_finished == null && options2.remote_finished !== null) {
          context.remote_finished = options2.remote_finished;
          has_changed = true;
        }
      }
      if ("remote_finished_ok" in options2) {
        if (context.remote_finished_ok !== options2.remote_finished_ok) {
          context.remote_finished_ok = options2.remote_finished_ok;
          has_changed = true;
        }
      }
      if ("dtls_cookie" in options2) {
        context.dtls_cookie = options2.dtls_cookie;
        has_changed = true;
      }
    }
    if (has_changed == true) {
      let pending = function(field) {
        return field in params_to_set ? params_to_set[field] : context[field];
      };
      let params_to_set = {};
      if (context.selected_version == null && context.local_supported_versions.length > 0 && context.remote_supported_versions.length > 0) {
        for (let i = 0; i < context.local_supported_versions.length; i++) {
          let v = context.local_supported_versions[i] | 0;
          for (let j = 0; j < context.remote_supported_versions.length; j++) {
            if ((context.remote_supported_versions[j] | 0) == v) {
              params_to_set["selected_version"] = v;
              break;
            }
          }
          if ("selected_version" in params_to_set == true && params_to_set.selected_version !== null) break;
        }
        if ("selected_version" in params_to_set == false || params_to_set.selected_version == null) {
        }
        if (context.isServer && params_to_set.selected_version !== null && params_to_set.selected_version !== TLS_VERSION.TLS1_3 && params_to_set.selected_version !== DTLS_VERSION.DTLS1_3) {
          context.remote_key_groups = {};
        }
      }
      if (context.selected_cipher_suite == null && context.local_supported_cipher_suites.length > 0 && context.remote_supported_cipher_suites.length > 0) {
        if (context.isServer && context.tls12_resume_state && context.selected_version !== TLS_VERSION.TLS1_3 && context.selected_version !== DTLS_VERSION.DTLS1_3) {
          let storedCipher = context.tls12_resume_state.cipher | 0;
          if (context.remote_supported_cipher_suites.indexOf(storedCipher) >= 0 && context.local_supported_cipher_suites.indexOf(storedCipher) >= 0) {
            params_to_set["selected_cipher_suite"] = storedCipher;
          } else {
            context.tls12_resume_state = null;
          }
        }
        let pskPassVersion = pending("selected_version");
        let pskPassIs13 = pskPassVersion === TLS_VERSION.TLS1_3 || pskPassVersion === DTLS_VERSION.DTLS1_3;
        if (context.isServer && context.psk_accepted && context.psk_offered && context.psk_offered.hash && pskPassIs13) {
          let pskHash = context.psk_offered.hash;
          let chosen = null;
          for (let i = 0; i < context.local_supported_cipher_suites.length; i++) {
            let cs = context.local_supported_cipher_suites[i] | 0;
            if (context.remote_supported_cipher_suites.indexOf(cs) < 0) continue;
            let meta = TLS_CIPHER_SUITES[cs];
            if (!meta || meta.hash !== pskHash) continue;
            if (!is_usable_cipher_suite(cs)) continue;
            chosen = cs;
            break;
          }
          if (chosen !== null) {
            params_to_set["selected_cipher_suite"] = chosen;
          } else {
            dbg(
              "SRV-PSK",
              "no mutually-supported cipher with hash",
              pskHash,
              "\u2014 rejecting PSK, falling back to full handshake"
            );
            context.psk_accepted = false;
            context.isResumed = false;
            context.psk_offered = null;
          }
        }
        if (!("selected_cipher_suite" in params_to_set)) {
          let localAuth = null;
          if (context.isServer) {
            try {
              if (context.cert_private_key) {
                let lk = local_private_key();
                localAuth = lk ? lk.asymmetricKeyType : null;
              }
            } catch (e) {
              localAuth = null;
            }
          }
          let suiteAuthOk = function(suite) {
            if (!context.isServer || localAuth === null) return true;
            let meta = TLS_CIPHER_SUITES[suite];
            if (!meta || !meta.sig || meta.sig === "TLS13") return true;
            if (meta.sig === "RSA") return localAuth === "rsa" || localAuth === "rsa-pss";
            if (meta.sig === "ECDSA") return localAuth === "ec";
            return true;
          };
          for (let i2 = 0; i2 < context.local_supported_cipher_suites.length; i2++) {
            let cs = context.local_supported_cipher_suites[i2] | 0;
            if (!suiteAuthOk(cs)) continue;
            if (!suite_matches_version(cs, pending("selected_version"))) continue;
            if (!is_usable_cipher_suite(cs)) continue;
            for (let j2 = 0; j2 < context.remote_supported_cipher_suites.length; j2++) {
              if ((context.remote_supported_cipher_suites[j2] | 0) == cs) {
                params_to_set["selected_cipher_suite"] = cs;
                break;
              }
            }
            if ("selected_cipher_suite" in params_to_set == true && params_to_set.selected_cipher_suite !== null) break;
          }
          if ("selected_cipher_suite" in params_to_set == false || params_to_set.selected_cipher_suite == null) {
          }
        }
      }
      if (context.isServer && context.tls12_resume_state && !context.tls12_abbreviated && params_to_set.selected_cipher_suite != null && (context.selected_version === TLS_VERSION.TLS1_2 || params_to_set.selected_version === TLS_VERSION.TLS1_2)) {
        let storedEMS = !!context.tls12_resume_state.extended_master_secret;
        let clientEMS = !!context.use_extended_master_secret;
        if (storedEMS !== clientEMS) {
          context.tls12_resume_state = null;
        } else {
          params_to_set["tls12_abbreviated"] = true;
          params_to_set["isResumed"] = true;
          params_to_set["base_secret"] = context.tls12_resume_state.master_secret;
          params_to_set["selected_session_id"] = context.remote_session_id || new Uint8Array(0);
        }
      }
      if (context.selected_alpn == null && context.local_supported_alpns && context.remote_supported_alpns) {
        for (let a = 0; a < context.local_supported_alpns.length; a++) {
          let cand = context.local_supported_alpns[a];
          for (let b = 0; b < context.remote_supported_alpns.length; b++) {
            if (context.remote_supported_alpns[b] === cand) {
              params_to_set["selected_alpn"] = cand;
              break;
            }
          }
          if ("selected_alpn" in params_to_set == true && params_to_set.selected_alpn !== null) break;
        }
      }
      if (context.selected_sni == null && context.remote_sni !== null) {
        params_to_set["selected_sni"] = context.remote_sni || null;
      }
      if (context.selected_session_id == null) {
        params_to_set["selected_session_id"] = context.remote_session_id || new Uint8Array(0);
      }
      if (context.selected_group == null) {
        if (context.local_supported_groups.length > 0 && context.remote_supported_groups.length > 0) {
          for (let i = 0; i < context.local_supported_groups.length; i++) {
            let g = context.local_supported_groups[i];
            if (context.remote_supported_groups.indexOf(g) < 0) continue;
            if (!is_supported_group(g)) continue;
            params_to_set["selected_group"] = g;
            break;
          }
        }
      }
      if (context.isServer && context.remote_supported_cipher_suites.length > 0) {
        let pickedVersion = pending("selected_version");
        if (pickedVersion === null && context.local_supported_versions.length > 0 && context.remote_supported_versions.length > 0) {
          fatalAlert(
            TLS_ALERT.PROTOCOL_VERSION,
            "No protocol version in common with the peer"
          );
          return;
        }
        let pickedCipher = pending("selected_cipher_suite");
        if (pickedCipher === null && context.local_supported_cipher_suites.length > 0 && context.remote_supported_cipher_suites.length > 0) {
          fatalAlert(
            TLS_ALERT.HANDSHAKE_FAILURE,
            "No cipher suite in common with the peer"
          );
          return;
        }
        let pickedGroup = pending("selected_group");
        if (pickedGroup === null && context.remote_supported_groups.length > 0 && context.local_supported_groups.length > 0) {
          fatalAlert(
            TLS_ALERT.HANDSHAKE_FAILURE,
            "No key-exchange group in common with the peer"
          );
          return;
        }
      }
      if (context.selected_group !== null && context.selected_group in context.local_key_groups == false) {
        let kp = generate_keypair(context.selected_group);
        if (kp) {
          params_to_set["add_local_key_groups"] = [
            {
              group: context.selected_group,
              private_key: kp.private_key,
              public_key: kp.public_key
            }
          ];
        }
      }
      let ecdheReady = context.selected_group !== null && context.ecdhe_shared_secret == null && context.selected_group in context.local_key_groups && context.selected_group in context.remote_key_groups;
      if (ecdheReady) {
        if (context.remote_key_groups[context.selected_group].public_key !== null && context.local_key_groups[context.selected_group].private_key !== null) {
          let remote_public_key = context.remote_key_groups[context.selected_group].public_key;
          let local_private_key2 = context.local_key_groups[context.selected_group].private_key;
          try {
            params_to_set["ecdhe_shared_secret"] = get_shared_secret(context.selected_group, local_private_key2, remote_public_key);
          } catch (e) {
            fatalAlert(TLS_ALERT.ILLEGAL_PARAMETER, "Invalid peer key share for group 0x" + context.selected_group.toString(16) + ": " + e.message);
            return;
          }
        }
      }
      if (context.isServer == true) {
        let hrrVersionNow = pending("selected_version");
        let hrrIs13 = hrrVersionNow === TLS_VERSION.TLS1_3 || hrrVersionNow === DTLS_VERSION.DTLS1_3;
        let hrrGroupNow = pending("selected_group");
        let hrrCipherNow = pending("selected_cipher_suite");
        if (context.hello_sent == false && !context.helloRetried && hrrIs13 && hrrGroupNow !== null && hrrCipherNow !== null && !(hrrGroupNow in context.remote_key_groups)) {
          context.helloRetried = true;
          let hashName = TLS_CIPHER_SUITES[hrrCipherNow].hash;
          let ch1_hash = getHashFn(hashName)(concatUint8Arrays2(context.transcript));
          let message_hash = build_message(TLS_MESSAGE_TYPE.MESSAGE_HASH, ch1_hash);
          context.transcript = [message_hash];
          reset_transcript_hash(hashName);
          let hrr_body = build_hello_retry_request({
            cipher_suite: hrrCipherNow,
            selected_version: context.selected_version,
            selected_group: hrrGroupNow,
            session_id: context.remote_session_id
          });
          let hrr_data = build_message(TLS_MESSAGE_TYPE.SERVER_HELLO, hrr_body);
          pushTranscript(hrr_data);
          ev.emit("message", 0, context.message_sent_seq, "hello_retry_request", hrr_data);
          context.message_sent_seq++;
          context.remote_random = null;
          context.remote_extensions = [];
          context.remote_supported_versions = [];
          context.remote_supported_cipher_suites = [];
          context.remote_supported_signature_algorithms = [];
        }
        let can_send_hello = false;
        if (context.hello_sent == false) {
          if (context.selected_version !== null && context.selected_cipher_suite !== null && context.selected_session_id !== null) {
            if (is13()) {
              if (context.selected_group in context.local_key_groups == true && context.local_key_groups[context.selected_group].public_key !== null) {
                if (!context.helloRetried || context.selected_group in context.remote_key_groups) {
                  can_send_hello = true;
                }
              }
            } else if (is12()) {
              if (!context.tls12_resume_pending) {
                can_send_hello = true;
              }
            }
          }
        }
        if (can_send_hello == true) {
          if (context.local_random == null) {
            context.local_random = new Uint8Array(randomBytes4(32));
            if (context.local_supported_versions.indexOf(TLS_VERSION.TLS1_3) >= 0) {
              if (context.selected_version === TLS_VERSION.TLS1_2) {
                context.local_random.set(DOWNGRADE_SENTINEL_TLS12, 24);
              } else if (context.selected_version === TLS_VERSION.TLS1_1 || context.selected_version === TLS_VERSION.TLS1_0) {
                context.local_random.set(DOWNGRADE_SENTINEL_TLS11, 24);
              }
            }
          }
          let build_message_params = null;
          if (is13()) {
            let shExtensions = [
              {
                type: "SUPPORTED_VERSIONS",
                value: context.selected_version
              },
              {
                type: "KEY_SHARE",
                value: {
                  group: context.selected_group,
                  key_exchange: context.local_key_groups[context.selected_group].public_key
                }
              }
            ];
            if (context.psk_accepted) {
              shExtensions.push({ type: "PRE_SHARED_KEY", value: { selected: 0 } });
            }
            build_message_params = {
              type: "server_hello",
              version: context.selected_version,
              random: context.local_random,
              // legacy_session_id_echo.
              //
              // TLS 1.3 (RFC 8446 §4.1.3) requires the server to echo the
              // client's legacy_session_id verbatim — that is the whole point
              // of the Appendix D.4 compatibility mode.
              //
              // DTLS 1.3 requires the OPPOSITE. RFC 9147 §5: "DTLS
              // implementations do not use the TLS 1.3 'compatibility mode'
              // described in Appendix D.4 of [TLS13]. DTLS servers MUST NOT
              // echo the 'legacy_session_id' value from the client and
              // endpoints MUST NOT send ChangeCipherSpec messages."
              //
              // Same field, same struct, opposite MUST — and the shared engine
              // was doing the TLS thing for both transports. A DTLS peer that
              // enforces §5 sees an echo it never expected. This is exactly the
              // shape of the other DTLS 1.3 bugs: a legacy field whose meaning
              // inverted between the two protocols.
              session_id: (function() {
                let isDtls = context.selected_version === DTLS_VERSION.DTLS1_3;
                return isDtls ? new Uint8Array(0) : context.remote_session_id;
              })(),
              cipher_suite: context.selected_cipher_suite,
              extensions: shExtensions
            };
          } else if (is12()) {
            let ext_list = [
              { type: "RENEGOTIATION_INFO", value: new Uint8Array(0) }
            ];
            if (context.use_extended_master_secret) {
              ext_list.push({ type: "EXTENDED_MASTER_SECRET", value: null });
            }
            if (context.selected_alpn) {
              ext_list.push({ type: "ALPN", value: [String(context.selected_alpn)] });
            }
            let isDtls12Here = context.selected_version === DTLS_VERSION.DTLS1_2;
            if (context.tls12_session_ticket_requested && !context.tls12_abbreviated && context.sessionTickets && !isDtls12Here) {
              ext_list.push({ type: "SESSION_TICKET", value: new Uint8Array(0) });
            }
            let srtpSel12 = negotiate_srtp_profile();
            if (srtpSel12 !== null) {
              context.selected_srtp_profile = srtpSel12;
              ext_list.push({
                type: "USE_SRTP",
                value: { profiles: [srtpSel12], mki: new Uint8Array(0) }
              });
            }
            for (let lei = 0; lei < context.local_extensions.length; lei++) {
              ext_list.push(context.local_extensions[lei]);
            }
            let sid_to_send;
            if (context.tls12_abbreviated) {
              sid_to_send = context.remote_session_id || new Uint8Array(0);
            } else if (context.selected_version === DTLS_VERSION.DTLS1_2) {
              sid_to_send = context.remote_session_id || new Uint8Array(0);
            } else {
              if (!context.tls12_session_id_for_store) {
                context.tls12_session_id_for_store = new Uint8Array(randomBytes4(32));
              }
              sid_to_send = context.tls12_session_id_for_store;
            }
            build_message_params = {
              type: "server_hello",
              version: context.selected_version,
              random: context.local_random,
              session_id: sid_to_send,
              cipher_suite: context.selected_cipher_suite,
              // e.g. 0xC02F
              // compression_method always 0
              extensions: ext_list
            };
          }
          if (build_message_params !== null) {
            let message_data = build_tls_message(build_message_params);
            pushTranscript(message_data);
            context.hello_sent = true;
            ev.emit("message", 0, context.message_sent_seq, "hello", message_data);
            context.message_sent_seq++;
          }
        }
      } else {
      }
      if (context.base_secret == null && context.selected_cipher_suite !== null) {
        if (is13() && context.ecdhe_shared_secret !== null) {
          let hashName = negotiated_hash();
          let result;
          let tx_hash = get_transcript_hash(hashName);
          if (context.psk_accepted && context.psk_offered && context.psk_offered.psk) {
            result = derive_handshake_traffic_secrets_psk_with_hash(hashName, context.psk_offered.psk, context.ecdhe_shared_secret, tx_hash, label_prefix());
          } else {
            result = derive_handshake_traffic_secrets_with_hash(hashName, context.ecdhe_shared_secret, tx_hash, label_prefix());
          }
          params_to_set["base_secret"] = result.handshake_secret;
          if (context.isServer == true) {
            params_to_set["remote_handshake_traffic_secret"] = result.client_handshake_traffic_secret;
            params_to_set["local_handshake_traffic_secret"] = result.server_handshake_traffic_secret;
          } else {
            params_to_set["local_handshake_traffic_secret"] = result.client_handshake_traffic_secret;
            params_to_set["remote_handshake_traffic_secret"] = result.server_handshake_traffic_secret;
          }
        } else if (is12() && context.local_random !== null && context.remote_random !== null) {
          if (context.ecdhe_shared_secret !== null) {
            let server_random, client_random;
            if (context.isServer == true) {
              server_random = context.local_random;
              client_random = context.remote_random;
            } else {
              server_random = context.remote_random;
              client_random = context.local_random;
            }
            if (context.use_extended_master_secret) {
              if (context.isServer || context.key_exchange_sent) {
                let hashFn = getHashFn(negotiated_hash());
                let emsTranscript = context._emsTranscriptLen ? context.transcript.slice(0, context._emsTranscriptLen) : context.transcript;
                let transcript_hash = hashFn(concatUint8Arrays2(emsTranscript));
                let master_secret = tls12_prf(context.ecdhe_shared_secret, "extended master secret", transcript_hash, 48, negotiated_hash());
                params_to_set["base_secret"] = master_secret;
              }
            } else {
              let master_secret = tls12_prf(context.ecdhe_shared_secret, "master secret", concatUint8Arrays2([client_random, server_random]), 48, negotiated_hash());
              params_to_set["base_secret"] = master_secret;
            }
          }
        }
      }
      if (context.isServer == true && is13()) {
        if (context.encrypted_exts_sent == false && context.hello_sent == true && context.local_handshake_traffic_secret !== null) {
          let extensions = [];
          if (context.selected_alpn !== null) {
            extensions.push({ type: "ALPN", value: [context.selected_alpn] });
          }
          if (context.remote_sni && !context.psk_accepted) {
            extensions.push({ type: "SERVER_NAME", value: null });
          }
          let srtpSel = negotiate_srtp_profile();
          if (srtpSel !== null) {
            context.selected_srtp_profile = srtpSel;
            extensions.push({
              type: "USE_SRTP",
              value: { profiles: [srtpSel], mki: new Uint8Array(0) }
            });
          }
          for (let i = 0; i < context.local_extensions.length; i++) {
            extensions.push(context.local_extensions[i]);
          }
          let message_data = build_tls_message({
            type: "encrypted_extensions",
            extensions
          });
          pushTranscript(message_data);
          context.encrypted_exts_sent = true;
          ev.emit("message", 1, context.message_sent_seq, "encrypted_extensions", message_data);
          context.message_sent_seq++;
        }
      }
      if (context.isServer == true && context.requestCert == true && !context.certificateRequestSent && context.encrypted_exts_sent == true && context.local_handshake_traffic_secret !== null && is13() && !context.psk_accepted) {
        let cr_data = build_tls_message({
          type: "certificate_request",
          certificate_request_context: new Uint8Array(0),
          signature_algorithms: context.local_supported_signature_algorithms
        });
        pushTranscript(cr_data);
        context.certificateRequestSent = true;
        ev.emit("message", 1, context.message_sent_seq, "certificate_request", cr_data);
        context.message_sent_seq++;
      }
      if (context.isServer == true && context.cert_sent == false && context.local_cert_chain !== null && !context.psk_accepted && !context.tls12_abbreviated) {
        let certDue13 = is13() && context.encrypted_exts_sent === true && context.local_handshake_traffic_secret !== null;
        let certDue12 = is12() && context.hello_sent === true;
        if (certDue13 || certDue12) {
          let message_data = build_tls_message({
            type: "certificate",
            version: context.selected_version,
            entries: context.local_cert_chain
          });
          pushTranscript(message_data);
          context.cert_sent = true;
          if (is13()) {
            ev.emit("message", 1, context.message_sent_seq, "certificate", message_data);
          } else {
            ev.emit("message", 0, context.message_sent_seq, "certificate", message_data);
          }
          context.message_sent_seq++;
        }
      }
      if (context.isServer == true && is13()) {
        if (context.cert_sent == true && context.cert_verify_sent == false && context.local_cert_chain !== null && context.local_handshake_traffic_secret !== null && context.selected_cipher_suite !== null) {
          let tbsHashName = negotiated_hash();
          let tbs_data = build_cert_verify_tbs_with_hash(tbsHashName, true, get_transcript_hash(tbsHashName));
          let cert_private_key_obj = local_private_key();
          let selected_scheme = pick_scheme(
            TLS_VERSION.TLS1_3,
            cert_private_key_obj,
            context.remote_supported_signature_algorithms || []
          );
          let sig_data = null;
          if (selected_scheme !== null) {
            sig_data = sign_with_scheme(
              TLS_VERSION.TLS1_3,
              selected_scheme,
              tbs_data,
              cert_private_key_obj
            );
          }
          if (selected_scheme === null || !sig_data) {
            fatalAlert(
              TLS_ALERT.HANDSHAKE_FAILURE,
              "No signature scheme shared with peer for our certificate"
            );
            return;
          }
          if (sig_data) {
            let message_data = build_tls_message({
              type: "certificate_verify",
              scheme: selected_scheme,
              signature: sig_data
            });
            pushTranscript(message_data);
            context.cert_verify_sent = true;
            ev.emit("message", 1, context.message_sent_seq, "certificate_verify", message_data);
            context.message_sent_seq++;
          } else {
          }
        }
      }
      if (context.key_exchange_sent == false && is12()) {
        if (context.selected_group !== null && context.selected_group in context.local_key_groups == true && context.local_key_groups[context.selected_group].public_key !== null) {
          if (context.isServer == false && context.remote_hello_done == true) {
            if (context.certificateRequested && !context.clientCertSent) {
              context.clientCertSent = true;
              let certEntries = [];
              if (context.local_cert_chain && context.local_cert_chain.length > 0) {
                certEntries = context.local_cert_chain;
              }
              let totalLen = 0;
              for (let ci = 0; ci < certEntries.length; ci++) {
                totalLen += 3 + certEntries[ci].cert.length;
              }
              let certBody = new Uint8Array(3 + totalLen);
              certBody[0] = totalLen >> 16 & 255;
              certBody[1] = totalLen >> 8 & 255;
              certBody[2] = totalLen & 255;
              let off = 3;
              for (let ci = 0; ci < certEntries.length; ci++) {
                let der = certEntries[ci].cert;
                certBody[off] = der.length >> 16 & 255;
                certBody[off + 1] = der.length >> 8 & 255;
                certBody[off + 2] = der.length & 255;
                certBody.set(der, off + 3);
                off += 3 + der.length;
              }
              let cert_data = build_message(TLS_MESSAGE_TYPE.CERTIFICATE, certBody);
              pushTranscript(cert_data);
              ev.emit("message", 0, context.message_sent_seq, "certificate", cert_data);
              context.message_sent_seq++;
            }
            let public_key = context.local_key_groups[context.selected_group].public_key;
            let message_data = build_tls_message({
              type: "client_key_exchange",
              public_key
            });
            pushTranscript(message_data);
            params_to_set["key_exchange_sent"] = true;
            context._emsTranscriptLen = context.transcript.length;
            ev.emit("message", 0, context.message_sent_seq, "client_key_exchange", message_data);
            context.message_sent_seq++;
            if (context.certificateRequested && context.cert_private_key && context.local_cert_chain && context.local_cert_chain.length > 0) {
              let transcript_data = concatUint8Arrays2(context.transcript);
              let cert_key_obj = local_private_key();
              let reqAlgs = peer_requested_sig_algs();
              let scheme = pick_scheme(TLS_VERSION.TLS1_2, cert_key_obj, reqAlgs);
              let signature = sign_with_scheme(TLS_VERSION.TLS1_2, scheme, transcript_data, cert_key_obj);
              let cvBody = new Uint8Array(2 + 2 + signature.length);
              cvBody[0] = scheme >> 8 & 255;
              cvBody[1] = scheme & 255;
              cvBody[2] = signature.length >> 8 & 255;
              cvBody[3] = signature.length & 255;
              cvBody.set(signature, 4);
              let cv_data = build_message(TLS_MESSAGE_TYPE.CERTIFICATE_VERIFY, cvBody);
              pushTranscript(cv_data);
              ev.emit("message", 0, context.message_sent_seq, "certificate_verify", cv_data);
              context.message_sent_seq++;
            }
          } else if (context.isServer == true && context.cert_sent == true) {
            let public_key = context.local_key_groups[context.selected_group].public_key;
            let params_head = build_server_ecdh_params(context.selected_group, public_key);
            let tbs_data = concatUint8Arrays2([context.remote_random, context.local_random, params_head]);
            let cert_private_key_obj = local_private_key();
            let scheme12 = pick_scheme(TLS_VERSION.TLS1_2, cert_private_key_obj, context.remote_supported_signature_algorithms);
            let sig_data = sign_with_scheme(TLS_VERSION.TLS1_2, scheme12, tbs_data, cert_private_key_obj);
            let message_data = build_tls_message({
              type: "server_key_exchange",
              group: context.selected_group,
              public_key,
              sig_alg: scheme12,
              signature: sig_data
            });
            pushTranscript(message_data);
            context.key_exchange_sent = true;
            ev.emit("message", 0, context.message_sent_seq, "server_key_exchange", message_data);
            context.message_sent_seq++;
          }
        }
      }
      if (context.isServer == true && context.requestCert == true && !context.certificateRequestSent && context.key_exchange_sent == true && !context.hello_done_sent && (context.selected_version === TLS_VERSION.TLS1_2 || context.selected_version === DTLS_VERSION.DTLS1_2)) {
        let cr_body = build_certificate_request({
          version: TLS_VERSION.TLS1_2,
          // rsa_sign(1), ecdsa_sign(64) — accept both. WebRTC uses ECDSA,
          // most other 1.2 deployments use RSA. The client picks whichever
          // matches its certificate.
          certificate_types: [1, 64],
          signature_algorithms: context.local_supported_signature_algorithms || [],
          certificate_authorities: []
          // empty: accept any CA
        });
        let cr_data = build_message(TLS_MESSAGE_TYPE.CERTIFICATE_REQUEST, cr_body);
        pushTranscript(cr_data);
        context.certificateRequestSent = true;
        ev.emit("message", 0, context.message_sent_seq, "certificate_request", cr_data);
        context.message_sent_seq++;
      }
      if (context.isServer == true && is12()) {
        if (context.hello_done_sent == false && context.key_exchange_sent == true) {
          let message_data = build_tls_message({
            type: "server_hello_done"
          });
          pushTranscript(message_data);
          context.hello_done_sent = true;
          ev.emit("message", 0, context.message_sent_seq, "server_hello_done", message_data);
          context.message_sent_seq++;
        }
      }
      if (context.selected_version === TLS_VERSION.TLS1_2 && context.isServer && !context.tls12_newsession_sent && context.sessionTickets && context.tls12_session_ticket_requested && !context.tls12_abbreviated && context.base_secret) {
        let can_send_nst = context.remote_finished_ok && !context.finished_sent;
        if (can_send_nst) {
          context.tls12_newsession_sent = true;
          if (!context.ticketKeys || context.ticketKeys.length !== 48) {
            context.ticketKeys = randomBytes4(48);
          }
          let ticket = encrypt_session_blob({
            v: 12,
            // blob kind: TLS 1.2
            version: context.selected_version,
            cipher: context.selected_cipher_suite,
            master_secret: context.base_secret,
            extended_master_secret: !!context.use_extended_master_secret,
            sni: context.selected_sni || context.remote_sni || null,
            alpn: context.selected_alpn || null,
            created: Date.now()
          }, context.ticketKeys);
          let nst_data = build_tls_message({
            type: "new_session_ticket_tls12",
            ticket_lifetime_hint: context.ticketLifetime,
            ticket
          });
          pushTranscript(nst_data);
          ev.emit("message", 0, context.message_sent_seq, "new_session_ticket", nst_data);
          context.message_sent_seq++;
          let server_session_blob = encode_client_session({
            v: 12,
            version: context.selected_version,
            cipher: context.selected_cipher_suite,
            master_secret: context.base_secret,
            extended_master_secret: !!context.use_extended_master_secret,
            ticket,
            session_id: context.remote_session_id || null,
            lifetime: context.ticketLifetime,
            sni: context.selected_sni || context.remote_sni || null,
            alpn: context.selected_alpn || null,
            created: Date.now()
          });
          ev.emit("session", server_session_blob);
        }
      }
      if (context.isServer == false && context.certificateRequested && !context.clientCertSent && context.remote_finished_ok == true && context.local_handshake_traffic_secret !== null) {
        context.clientCertSent = true;
        if (context.clientCert && context.clientKey) {
          let certCtx = secure_context_default({ key: context.clientKey, cert: context.clientCert });
          let cert_data = build_tls_message({
            type: "certificate",
            version: TLS_VERSION.TLS1_3,
            entries: certCtx.certificateChain,
            certificate_request_context: context.certificateRequestContext || new Uint8Array(0)
          });
          pushTranscript(cert_data);
          ev.emit("message", 1, context.message_sent_seq, "certificate", cert_data);
          context.message_sent_seq++;
          let hashName = negotiated_hash();
          let transcript_hash = get_transcript_hash(hashName);
          let clientKeyObj = createPrivateKey({
            key: Buffer.from(certCtx.privateKey),
            format: "der",
            type: "pkcs8"
          });
          let peerSigAlgs = peer_requested_sig_algs();
          let scheme = pick_scheme(TLS_VERSION.TLS1_3, clientKeyObj, peerSigAlgs);
          if (scheme === null) {
            fatalAlert(TLS_ALERT.HANDSHAKE_FAILURE, "No signature scheme shared with server for client certificate");
            return;
          }
          let cvHash = negotiated_hash();
          let clientTbs = build_cert_verify_tbs_with_hash(cvHash, false, get_transcript_hash(cvHash));
          let signature = sign_with_scheme(TLS_VERSION.TLS1_3, scheme, clientTbs, clientKeyObj);
          let cv_data = build_tls_message({
            type: "certificate_verify",
            scheme,
            signature
          });
          pushTranscript(cv_data);
          ev.emit("message", 1, context.message_sent_seq, "certificate_verify", cv_data);
          context.message_sent_seq++;
        } else {
          let cert_data = build_tls_message({
            type: "certificate",
            version: TLS_VERSION.TLS1_3,
            entries: [],
            certificate_request_context: context.certificateRequestContext || new Uint8Array(0)
          });
          pushTranscript(cert_data);
          ev.emit("message", 1, context.message_sent_seq, "certificate", cert_data);
          context.message_sent_seq++;
        }
      }
      if (context.finished_sent == false && context.selected_cipher_suite !== null && (context.base_secret !== null || context.local_handshake_traffic_secret !== null)) {
        if (is13() && context.local_handshake_traffic_secret !== null) {
          let clientFinishedDue = context.isServer === false && context.remote_finished_ok === true && context.local_app_traffic_secret !== null && context.remote_app_traffic_secret !== null;
          let serverCertFinishedDue = context.isServer === true && context.cert_verify_sent === true && context.local_cert_chain !== null;
          let serverPskFinishedDue = context.isServer === true && context.psk_accepted === true && context.encrypted_exts_sent === true;
          if (clientFinishedDue || serverCertFinishedDue || serverPskFinishedDue) {
            let finHashName = negotiated_hash();
            let finished_data = get_handshake_finished_with_hash(finHashName, context.local_handshake_traffic_secret, get_transcript_hash(finHashName, label_prefix()));
            context.local_finished_data = finished_data;
            let message_data = build_tls_message({
              type: "finished",
              data: finished_data
            });
            pushTranscript(message_data);
            if (context.isServer && context.tls13_app_transcript_hash === null) {
              context.tls13_app_transcript_hash = get_transcript_hash(finHashName);
            }
            context.finished_sent = true;
            ev.emit("message", 1, context.message_sent_seq, "finished", message_data);
            context.message_sent_seq++;
          }
        } else if (is12()) {
          let can_send_finished;
          if (context.tls12_abbreviated) {
            if (context.isServer) {
              can_send_finished = context.hello_sent == true;
            } else {
              can_send_finished = context.remote_finished_ok == true;
            }
          } else {
            if (context.isServer) {
              can_send_finished = context.remote_finished_ok == true;
            } else {
              can_send_finished = context.key_exchange_sent == true;
            }
          }
          if (can_send_finished) {
            let finishedHashName = negotiated_hash();
            let transcript_hash = get_transcript_hash(finishedHashName);
            let finished_data;
            if (context.isServer == true) {
              finished_data = tls12_prf(context.base_secret, "server finished", transcript_hash, 12, finishedHashName);
            } else {
              finished_data = tls12_prf(context.base_secret, "client finished", transcript_hash, 12, finishedHashName);
            }
            context.local_finished_data = finished_data;
            let message_data = build_tls_message({
              type: "finished",
              data: finished_data
            });
            pushTranscript(message_data);
            context.finished_sent = true;
            ev.emit("message", 1, context.message_sent_seq, "finished", message_data);
            context.message_sent_seq++;
          }
        }
      }
      if (is13()) {
        if (context.base_secret !== null && context.local_app_traffic_secret == null && context.remote_app_traffic_secret == null) {
          if (context.isServer == true && context.finished_sent == true && context.remote_finished_ok == false || context.isServer == false && context.finished_sent == false && context.remote_finished_ok == true) {
            let appHashName = negotiated_hash();
            let appTranscriptHash = context.tls13_app_transcript_hash;
            if (appTranscriptHash === null) {
              fatalAlert(
                TLS_ALERT.INTERNAL_ERROR,
                "Internal error: app traffic secrets requested before the server Finished transcript checkpoint"
              );
              return;
            }
            let result2 = derive_app_traffic_secrets_with_hash(appHashName, context.base_secret, appTranscriptHash, label_prefix());
            params_to_set["tls13_master_secret"] = result2.master_secret;
            params_to_set["exporter_master_secret"] = derive_exporter_master_secret_with_hash(appHashName, result2.master_secret, appTranscriptHash, label_prefix());
            params_to_set["base_secret"] = null;
            if (context.isServer === true) {
              params_to_set["local_app_traffic_secret"] = result2.server_app_traffic_secret;
              params_to_set["remote_app_traffic_secret"] = result2.client_app_traffic_secret;
            } else {
              params_to_set["local_app_traffic_secret"] = result2.client_app_traffic_secret;
              params_to_set["remote_app_traffic_secret"] = result2.server_app_traffic_secret;
            }
          }
        }
      }
      if (context.expected_remote_finished == null && context.selected_cipher_suite !== null) {
        if (is13() && context.remote_handshake_traffic_secret !== null) {
          if (context.remote_finished !== null) {
            let remoteFinHashName = negotiated_hash();
            params_to_set["expected_remote_finished"] = get_handshake_finished_with_hash(remoteFinHashName, context.remote_handshake_traffic_secret, get_transcript_hash(remoteFinHashName, label_prefix()));
          }
        } else if (is12() && context.base_secret !== null) {
          if (context.remote_finished !== null) {
            let tls12FinHashName = negotiated_hash();
            let transcript_hash = get_transcript_hash(tls12FinHashName);
            if (context.isServer == true) {
              params_to_set["expected_remote_finished"] = tls12_prf(context.base_secret, "client finished", transcript_hash, 12, tls12FinHashName);
            } else {
              params_to_set["expected_remote_finished"] = tls12_prf(context.base_secret, "server finished", transcript_hash, 12, tls12FinHashName);
            }
          }
        }
      }
      if (context.remote_finished_ok == false && context.remote_finished !== null && context.expected_remote_finished !== null) {
        if (context.remote_finished.length !== context.expected_remote_finished.length) {
          fatalAlert(TLS_ALERT.DECODE_ERROR, "Finished verify_data has wrong length (" + context.remote_finished.length + ", expected " + context.expected_remote_finished.length + ")");
          return;
        }
        if (timingSafeEqualU8(context.remote_finished, context.expected_remote_finished) == true) {
          let message_data = build_tls_message({
            type: "finished",
            data: context.remote_finished
          });
          pushTranscript(message_data);
          if (!context.isServer && context.selected_cipher_suite !== null && (context.selected_version === TLS_VERSION.TLS1_3 || context.selected_version === DTLS_VERSION.DTLS1_3) && context.tls13_app_transcript_hash === null) {
            let ckHash = negotiated_hash();
            context.tls13_app_transcript_hash = get_transcript_hash(ckHash);
          }
          params_to_set["remote_finished_ok"] = true;
          context.remote_finished_data = context.remote_finished;
          context.remote_finished = null;
          context.expected_remote_finished = null;
        } else {
          context.remote_finished = null;
          fatalAlert(TLS_ALERT.DECRYPT_ERROR, "Finished verify_data mismatch");
          return;
        }
      }
      if (context.state !== "connected" && context.remote_finished_ok == true && (is13() && context.local_app_traffic_secret !== null && context.remote_app_traffic_secret !== null || is12())) {
        if (!context.isServer && !context.psk_accepted && !context.tls12_abbreviated && context.peerSignatureVerified !== true) {
          fatalAlert(
            TLS_ALERT.UNEXPECTED_MESSAGE,
            "Handshake completed without a verified server signature"
          );
          return;
        }
        if (context.isServer && !context.psk_accepted && !context.tls12_abbreviated) {
          let clientCertPresent = !!(context.remote_cert_chain && context.remote_cert_chain.length > 0);
          if (context.requestCert && context.rejectUnauthorized && !clientCertPresent) {
            fatalAlert(
              TLS_ALERT.CERTIFICATE_REQUIRED,
              "Client certificate was required but none was provided"
            );
            return;
          }
          if (clientCertPresent && (context.selected_version === TLS_VERSION.TLS1_3 || context.selected_version === DTLS_VERSION.DTLS1_3) && context.peerSignatureVerified !== true) {
            fatalAlert(
              TLS_ALERT.UNEXPECTED_MESSAGE,
              "Client sent a certificate without a valid CertificateVerify"
            );
            return;
          }
        }
        context.state = "connected";
        context.handshakeEndTime = Date.now();
        ev.emit("secureConnect");
        if (is13() && context.tls13_master_secret && !context.resumption_master_secret) {
          let hashName = negotiated_hash();
          context.resumption_master_secret = derive_resumption_master_secret_with_hash(
            hashName,
            context.tls13_master_secret,
            get_transcript_hash(hashName, label_prefix())
          );
        }
        if (is13() && context.isServer && !context.session_ticket_sent && context.sessionTickets && context.resumption_master_secret) {
          context.session_ticket_sent = true;
          let hashName = negotiated_hash();
          let ticket_nonce = new Uint8Array([context.ticket_nonce_counter++]);
          let psk = derive_psk(hashName, context.resumption_master_secret, ticket_nonce, label_prefix());
          let ticket_age_add = randomBytes4(4).readUInt32BE(0);
          let ticket_lifetime = context.ticketLifetime;
          dbg(
            "SRV-NST",
            "issuing TLS 1.3 NST \u2014 cipher:",
            "0x" + context.selected_cipher_suite.toString(16),
            "hash:",
            hashName,
            "transcript len:",
            concatUint8Arrays2(context.transcript).length
          );
          dbg(
            "SRV-NST",
            "ticket_nonce:",
            hexPreview(ticket_nonce, 4),
            "age_add:",
            ticket_age_add,
            "lifetime:",
            ticket_lifetime
          );
          dbg(
            "SRV-NST",
            "resumption_master_secret:",
            hexPreview(context.resumption_master_secret, 8),
            "derived psk:",
            hexPreview(psk, 8)
          );
          if (!context.ticketKeys || context.ticketKeys.length !== 48) {
            context.ticketKeys = randomBytes4(48);
          }
          let ticket = encrypt_session_blob({
            v: 13,
            // blob kind: TLS 1.3 PSK
            version: context.selected_version,
            cipher: context.selected_cipher_suite,
            psk,
            age_add: ticket_age_add,
            sni: context.selected_sni || context.remote_sni || null,
            alpn: context.selected_alpn || null,
            created: Date.now()
          }, context.ticketKeys);
          let nst_data = build_message(
            TLS_MESSAGE_TYPE.NEW_SESSION_TICKET,
            build_new_session_ticket({
              ticket_lifetime,
              ticket_age_add,
              ticket_nonce,
              ticket,
              extensions: []
            })
          );
          ev.emit("message", 2, context.message_sent_seq, "new_session_ticket", nst_data);
          context.message_sent_seq++;
          let server_session_blob = encode_client_session({
            v: 13,
            version: context.selected_version,
            cipher: context.selected_cipher_suite,
            ticket,
            psk,
            age_add: ticket_age_add,
            lifetime: ticket_lifetime,
            sni: context.selected_sni || context.remote_sni || null,
            alpn: context.selected_alpn || null,
            created: Date.now()
          });
          ev.emit("session", server_session_blob);
        }
        if (context.selected_version === TLS_VERSION.TLS1_2 && context.isServer && !context.tls12_abbreviated && !context.tls12_newsession_sent && context.tls12_session_id_for_store && !context.tls12_session_id_emitted && context.base_secret && context.remote_finished_ok) {
          context.tls12_session_id_emitted = true;
          if (!context.ticketKeys || context.ticketKeys.length !== 48) {
            context.ticketKeys = randomBytes4(48);
          }
          let stored_blob = encrypt_session_blob({
            v: 12,
            version: context.selected_version,
            cipher: context.selected_cipher_suite,
            master_secret: context.base_secret,
            extended_master_secret: !!context.use_extended_master_secret,
            sni: context.selected_sni || context.remote_sni || null,
            alpn: context.selected_alpn || null,
            created: Date.now()
          }, context.ticketKeys);
          ev.emit("newSession", context.tls12_session_id_for_store, stored_blob, function() {
          });
        }
        if (context.selected_version === TLS_VERSION.TLS1_2 && !context.isServer && !context.tls12_abbreviated && !context.tls12_client_session_emitted && context.remote_session_id && context.remote_session_id.length > 0 && context.base_secret && context.remote_finished_ok) {
          context.tls12_client_session_emitted = true;
          let session_blob = encode_client_session({
            v: 12,
            // blob kind: TLS 1.2
            version: context.selected_version,
            cipher: context.selected_cipher_suite,
            master_secret: context.base_secret,
            extended_master_secret: !!context.use_extended_master_secret,
            ticket: null,
            // no ticket — Session ID only
            session_id: context.remote_session_id,
            sni: context.local_sni || null,
            alpn: context.selected_alpn || null,
            created: Date.now()
          });
          ev.emit("session", session_blob);
        }
      }
      set_context(params_to_set);
    }
  }
  function validatePeerCertificate() {
    if (!context.remote_cert_chain || context.remote_cert_chain.length === 0) {
      context.authorizationError = "NO_PEER_CERTIFICATE";
      context.peerAuthorized = false;
      return;
    }
    try {
      let certDer = context.remote_cert_chain[0].cert;
      let x509 = new X509Certificate(certDer);
      let now = /* @__PURE__ */ new Date();
      if (now < new Date(x509.validFrom)) {
        context.authorizationError = "CERT_NOT_YET_VALID";
        context.peerAuthorized = false;
        return;
      }
      if (now > new Date(x509.validTo)) {
        context.authorizationError = "CERT_HAS_EXPIRED";
        context.peerAuthorized = false;
        return;
      }
      if (!context.isServer && context.local_sni) {
        if (!x509.checkHost(context.local_sni)) {
          context.authorizationError = "ERR_TLS_CERT_ALTNAME_INVALID";
          context.peerAuthorized = false;
          return;
        }
      }
      if (context.ca) {
        let cas = Array.isArray(context.ca) ? context.ca : [context.ca];
        let verified = false;
        for (let i = 0; i < cas.length; i++) {
          try {
            let caX509 = new X509Certificate(cas[i]);
            if (x509.checkIssued(caX509) && x509.verify(caX509.publicKey)) {
              verified = true;
              break;
            }
          } catch (e) {
          }
        }
        if (!verified) {
          context.authorizationError = "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
          context.peerAuthorized = false;
          return;
        }
      }
      context.peerAuthorized = true;
      context.authorizationError = null;
    } catch (e) {
      context.authorizationError = e.message || "CERTIFICATE_PARSE_ERROR";
      context.peerAuthorized = false;
    }
  }
  function sendAlert(level, description) {
    if (context.state === "error" || context.state === "closed") return;
    let alertData = new Uint8Array([level, description]);
    let epoch;
    if (context.state === "connected") {
      epoch = 2;
    } else if (is13() && context.local_app_traffic_secret !== null && context.finished_sent) {
      epoch = 2;
    } else if (is13() && context.local_handshake_traffic_secret !== null) {
      epoch = 1;
    } else {
      epoch = 0;
    }
    ev.emit("message", epoch, 0, "alert", alertData);
    ev.emit("alert", { level, description });
    if (level === 2) {
      context.state = "error";
    }
  }
  function close() {
    if (context.state === "closed" || context.state === "error") {
      context.state = "closed";
      return;
    }
    sendAlert(1, 0);
    context.state = "closed";
  }
  if (context.isServer == false) {
    setTimeout(function() {
      if (context.local_random == null) {
        context.local_random = new Uint8Array(randomBytes4(32));
      }
      if (context.local_session_id == null) {
        context.local_session_id = new Uint8Array(randomBytes4(32));
      }
      let offers13 = context.local_supported_versions.length === 0 || context.local_supported_versions.indexOf(TLS_VERSION.TLS1_3) >= 0 || context.local_supported_versions.indexOf(DTLS_VERSION.DTLS1_3) >= 0;
      let offers12 = context.local_supported_versions.length === 0 || context.local_supported_versions.some((v) => v !== TLS_VERSION.TLS1_3 && v !== DTLS_VERSION.DTLS1_3);
      if (context.local_supported_cipher_suites.length <= 0) {
        context.local_supported_cipher_suites = default_cipher_suites(offers13, offers12);
      }
      if (context.local_supported_groups.length <= 0) {
        context.local_supported_groups = SUPPORTED_GROUPS.slice();
      }
      if (context.local_supported_versions.length <= 0) {
        context.local_supported_versions = [772, 771];
      }
      let initialGroup = null;
      let initialKp = null;
      for (let gi = 0; gi < context.local_supported_groups.length; gi++) {
        let g = context.local_supported_groups[gi];
        if (!is_supported_group(g)) continue;
        let kp = generate_keypair(g);
        if (!kp) continue;
        initialGroup = g;
        initialKp = kp;
        break;
      }
      if (initialKp === null) {
        fatalAlert(
          TLS_ALERT.INTERNAL_ERROR,
          "No configured key-exchange group is implemented \u2014 cannot build a key_share"
        );
        return;
      }
      let public_key = initialKp.public_key;
      context.local_key_groups[initialGroup] = {
        public_key: initialKp.public_key,
        private_key: initialKp.private_key
      };
      let ch_sigalgs = context.local_supported_signature_algorithms && context.local_supported_signature_algorithms.length > 0 ? context.local_supported_signature_algorithms : default_signature_schemes();
      context.local_supported_signature_algorithms = ch_sigalgs;
      let extensions = build_client_hello_extensions({
        keyShareGroup: initialGroup,
        keySharePublic: public_key,
        cookie: null
      });
      let sessionData = null;
      if (options.session) {
        if (options.session instanceof Uint8Array || Buffer.isBuffer(options.session)) {
          sessionData = decode_client_session(options.session);
        } else if (typeof options.session === "object") {
          sessionData = options.session;
        }
      } else if (options.psk) {
        sessionData = options.psk;
      }
      let message_data;
      if (sessionData && sessionData.psk && sessionData.ticket && sessionData.cipher) {
        extensions.push({ type: "PSK_KEY_EXCHANGE_MODES", value: [1] });
        context.psk_offered = {
          identity: sessionData.ticket,
          psk: sessionData.psk instanceof Uint8Array ? sessionData.psk : new Uint8Array(sessionData.psk),
          cipher: sessionData.cipher,
          age_add: sessionData.age_add || 0
        };
        let ticketAge = sessionData.lifetime ? Math.min((Date.now() - (sessionData.created || Date.now())) / 1e3, sessionData.lifetime) * 1e3 : 0;
        let obfuscatedAge = (ticketAge + (sessionData.age_add || 0) & 4294967295) >>> 0;
        let hashName = TLS_CIPHER_SUITES[sessionData.cipher] ? TLS_CIPHER_SUITES[sessionData.cipher].hash : "sha256";
        let hashLen = getHashFn(hashName).outputLen;
        let placeholderBinder = new Uint8Array(hashLen);
        let pskExt = {
          type: "PRE_SHARED_KEY",
          value: {
            identities: [{ identity: sessionData.ticket, age: obfuscatedAge }],
            binders: [placeholderBinder]
          }
        };
        extensions.push(pskExt);
        note_offered_extensions([pskExt]);
        let build_message_params = {
          type: "client_hello",
          version: 771,
          random: context.local_random,
          session_id: context.local_session_id,
          cookie: context.dtls_cookie,
          // BUGFIX: `cipher_suites` (plural) is what wire.js's client_hello
          // builder actually reads; the singular key was silently ignored and
          // wire.js substituted its own hardcoded fallback list — the
          // configured cipher suites never reached the wire. Both names passed.
          cipher_suites: context.local_supported_cipher_suites,
          cipher_suite: context.local_supported_cipher_suites,
          extensions
        };
        let tempMessage = build_tls_message(build_message_params);
        let bindersSize = 2 + 1 + hashLen;
        let truncatedMessage = tempMessage.slice(0, tempMessage.length - bindersSize);
        let binder_key = derive_binder_key(hashName, context.psk_offered.psk, false, label_prefix());
        let binder = compute_psk_binder(hashName, binder_key, truncatedMessage, label_prefix());
        dbg(
          "CLI-PSK",
          "ticket:",
          hexPreview(sessionData.ticket, 24),
          "cipher:",
          "0x" + sessionData.cipher.toString(16),
          "hash:",
          hashName
        );
        dbg(
          "CLI-PSK",
          "psk:",
          hexPreview(sessionData.psk, 8),
          "age_add:",
          sessionData.age_add,
          "lifetime:",
          sessionData.lifetime,
          "ticketAge (ms):",
          ticketAge,
          "obfuscatedAge:",
          obfuscatedAge
        );
        dbg(
          "CLI-PSK",
          "truncatedMessage len:",
          truncatedMessage.length,
          "full CH len (after real binder):",
          "see next"
        );
        dbg("CLI-PSK", "sent binder:", hexPreview(binder, 16));
        pskExt.value.binders = [binder];
        message_data = build_tls_message(build_message_params);
      } else if (sessionData && sessionData.v === 12 && sessionData.master_secret) {
        context.tls12_client_session = sessionData;
        if (sessionData.ticket && sessionData.ticket.length > 0) {
          let stEntry = null;
          for (let ei = 0; ei < extensions.length; ei++) {
            if (extensions[ei] && extensions[ei].type === "SESSION_TICKET") {
              stEntry = extensions[ei];
              break;
            }
          }
          if (stEntry) stEntry.value = sessionData.ticket;
        }
        let sid = context.local_session_id;
        if (sessionData.session_id && sessionData.session_id.length > 0) {
          sid = sessionData.session_id;
          context.local_session_id = sid;
        }
        let build_message_params = {
          type: "client_hello",
          version: 771,
          random: context.local_random,
          session_id: sid,
          cookie: context.dtls_cookie,
          // BUGFIX: `cipher_suites` (plural) is what wire.js's client_hello
          // builder actually reads; the singular key was silently ignored and
          // wire.js substituted its own hardcoded fallback list — the
          // configured cipher suites never reached the wire. Both names passed.
          cipher_suites: context.local_supported_cipher_suites,
          cipher_suite: context.local_supported_cipher_suites,
          extensions
        };
        message_data = build_tls_message(build_message_params);
      } else {
        let build_message_params = {
          type: "client_hello",
          version: 771,
          random: context.local_random,
          session_id: context.local_session_id,
          cookie: context.dtls_cookie,
          // BUGFIX: `cipher_suites` (plural) is what wire.js's client_hello
          // builder actually reads; the singular key was silently ignored and
          // wire.js substituted its own hardcoded fallback list — the
          // configured cipher suites never reached the wire. Both names passed.
          cipher_suites: context.local_supported_cipher_suites,
          cipher_suite: context.local_supported_cipher_suites,
          extensions
        };
        message_data = build_tls_message(build_message_params);
      }
      pushTranscript(message_data);
      context.hello_sent = true;
      ev.emit("message", 0, context.message_sent_seq, "hello", message_data);
      context.message_sent_seq++;
    }, 0);
  }
  let api = {
    /**
     * Raw context object. Advanced users (QUIC, DTLS) can read/write
     * any internal state directly. Use convenience getters below when possible.
     */
    context,
    /** Whether this session is server-side. */
    isServer: context.isServer,
    /** Whether this connection used PSK resumption (true after secureConnect if PSK was accepted). */
    get isResumed() {
      return context.isResumed;
    },
    /** Register an event listener.
     *  Events:
     *    'hello'            — fired when remote Hello is received. Server should
     *                          call set_context() with local preferences here.
     *    'message'          — (epoch, seq, type, data) handshake/alert message ready to send.
     *                          epoch 0=cleartext, 1=handshake-encrypted, 2=app-encrypted.
     *                          type: 'hello'|'finished'|'alert'|etc.
     *                          The caller must frame this into a TLS record.
     *    'alert'            — ({level, description}) TLS alert sent or received.
     *    'secureConnect'    — handshake complete, app data can flow.
     */
    on: function(name, fn) {
      ev.on(name, fn);
    },
    off: function(name, fn) {
      ev.off(name, fn);
    },
    /** Feed an incoming handshake message (without record header). */
    message: process_income_message,
    /** Set negotiation parameters. See context fields for available keys. */
    set_context,
    /** Close the session (sends close_notify alert). */
    close,
    /** Send a TLS alert. level: 1=warning, 2=fatal. See wire.TLS_ALERT for descriptions. */
    sendAlert,
    // ---- Convenience getters ----
    /** Returns the negotiated TLS version (e.g. 0x0303 for TLS 1.2, 0x0304 for TLS 1.3), or null. */
    getVersion: function() {
      return context.selected_version;
    },
    /**
     * Current session state: 'new' | 'handshaking' | 'connected' | 'error' | 'closed'.
     *
     * Exposed so a transport can tell whether the session is still alive
     * WITHOUT reaching into context. A transport that keeps feeding records to
     * an aborted session decrypts them under keys the peer no longer uses and
     * reports a misleading bad_record_mac, hiding the real failure.
     */
    getState: function() {
      return context.state;
    },
    /** Returns the negotiated cipher suite code (e.g. 0x1301, 0xC02F), or null. */
    getCipher: function() {
      return context.selected_cipher_suite;
    },
    /** Returns the negotiated ALPN protocol string (e.g. 'h2'), or null. */
    getALPN: function() {
      return context.selected_alpn || null;
    },
    /** Returns the remote certificate chain, or null. */
    getPeerCertificate: function() {
      return context.remote_cert_chain || null;
    },
    /** Whether the peer certificate passed validation. */
    get authorized() {
      return context.peerAuthorized;
    },
    /** The authorization error string, or null if authorized. */
    get authorizationError() {
      return context.authorizationError;
    },
    /** Returns traffic secrets for record-layer key derivation.
     *  Individual fields are null until negotiated.
     *  TLS 1.3: use localAppSecret/remoteAppSecret after secureConnect.
     *  TLS 1.2: use masterSecret + randoms after key exchange.
     */
    getTrafficSecrets: function() {
      return {
        isServer: context.isServer,
        version: context.selected_version,
        cipher: context.selected_cipher_suite,
        // TLS 1.3
        localAppSecret: context.local_app_traffic_secret,
        remoteAppSecret: context.remote_app_traffic_secret,
        // Handshake-epoch secrets. The record layer needs these to encrypt an
        // alert raised BEFORE anything has been written at epoch 1 — an abort
        // during the peer's flight is exactly that case, and without them the
        // alert could only go out in cleartext.
        localHandshakeSecret: context.local_handshake_traffic_secret,
        remoteHandshakeSecret: context.remote_handshake_traffic_secret,
        // TLS 1.2
        masterSecret: context.base_secret,
        localRandom: context.local_random,
        remoteRandom: context.remote_random
      };
    },
    /** Returns handshake traffic secrets (available during handshake, before secureConnect). */
    getHandshakeSecrets: function() {
      return {
        localSecret: context.local_handshake_traffic_secret,
        remoteSecret: context.remote_handshake_traffic_secret,
        cipher: context.selected_cipher_suite
      };
    },
    /**
     * Export keying material (RFC 5705 for TLS 1.2, RFC 8446 §7.5 for
     * TLS 1.3). Mirrors Node's tls.TLSSocket#exportKeyingMaterial.
     *
     * DTLS-SRTP (RFC 5764) usage:
     *   session.exportKeyingMaterial(len, 'EXTRACTOR-dtls_srtp')
     * with NO context argument. Note the TLS 1.2 subtlety: "no context"
     * and "empty context" produce different output — omit the argument
     * (or pass null) for the RFC 5764 form.
     *
     * Returns a Buffer of `length` bytes, or null before the secrets
     * are available (handshake not far enough along).
     *
     * NOTE: the previous implementation was TLS 1.3-only AND derived from
     * the app traffic secret in a single HKDF stage — which is not the
     * RFC 8446 §7.5 construction and would not interoperate with
     * OpenSSL/BoringSSL exporters. Both issues are fixed here; if anything
     * consumed the old output, its derived values will change.
     *
     * @param {number} length
     * @param {string} label
     * @param {Uint8Array|Buffer|null} [context_value]
     * @returns {Buffer|null}
     */
    /**
     * The negotiated DTLS-SRTP protection profile (RFC 5764), or null if none
     * was agreed. Pair with exportKeyingMaterial(len, 'EXTRACTOR-dtls_srtp').
     */
    getSelectedSrtpProfile: function() {
      return context.selected_srtp_profile;
    },
    exportKeyingMaterial: function(length2, label, context_value) {
      if (!context.selected_cipher_suite || !length2 || !label) return null;
      var suite = TLS_CIPHER_SUITES[context.selected_cipher_suite];
      if (!suite) return null;
      var is132 = context.selected_version === TLS_VERSION.TLS1_3 || context.selected_version === DTLS_VERSION.DTLS1_3;
      if (is132) {
        if (!context.exporter_master_secret) return null;
        return Buffer.from(tls13_exporter(
          suite.hash,
          context.exporter_master_secret,
          label,
          context_value != null ? context_value : null,
          length2,
          label_prefix()
        ));
      }
      if (!context.base_secret || !context.local_random || !context.remote_random) return null;
      var clientRandom = context.isServer ? context.remote_random : context.local_random;
      var serverRandom = context.isServer ? context.local_random : context.remote_random;
      return Buffer.from(tls12_exporter(
        suite.hash,
        context.base_secret,
        label,
        clientRandom,
        serverRandom,
        context_value != null ? context_value : null,
        length2
      ));
    },
    /**
     * All extensions the peer sent in its hello (ClientHello when we're
     * the server, ServerHello when we're the client), as parsed by
     * wire.parse_extensions: [{ type, name, data, value }].
     * `data` is the raw extension payload (Uint8Array); `value` is the
     * decoded form for known extensions, null for unknown ones.
     */
    getRemoteExtensions: function() {
      return context.remote_extensions ? context.remote_extensions.slice() : [];
    },
    /**
     * Look up a single peer extension by its numeric type
     * (e.g. 14 = use_srtp, 0x39 = QUIC transport parameters).
     * Returns the { type, name, data, value } entry, or null.
     */
    getRemoteExtension: function(type) {
      var list = context.remote_extensions || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].type === type) return list[i];
      }
      return null;
    },
    /** Returns the local Finished verify_data (Buffer), or null. */
    getFinished: function() {
      return context.local_finished_data ? Buffer.from(context.local_finished_data) : null;
    },
    /** Returns the peer Finished verify_data (Buffer), or null. */
    getPeerFinished: function() {
      return context.remote_finished_data ? Buffer.from(context.remote_finished_data) : null;
    },
    /** Returns the ECDHE shared secret (Uint8Array), or null. For research/advanced use. */
    getSharedSecret: function() {
      return context.ecdhe_shared_secret ? Buffer.from(context.ecdhe_shared_secret) : null;
    },
    /** Handshake duration in ms, or null if not completed. */
    get handshakeDuration() {
      if (context.handshakeStartTime && context.handshakeEndTime)
        return context.handshakeEndTime - context.handshakeStartTime;
      return null;
    },
    /** Full negotiation result — all selected parameters in one object. */
    getNegotiationResult: function() {
      let cipherInfo = context.selected_cipher_suite ? TLS_CIPHER_SUITES[context.selected_cipher_suite] : null;
      return {
        version: context.selected_version,
        versionName: context.selected_version === 772 ? "TLSv1.3" : context.selected_version === 65276 ? "DTLSv1.3" : context.selected_version === 771 ? "TLSv1.2" : context.selected_version === 65277 ? "DTLSv1.2" : null,
        cipher: context.selected_cipher_suite,
        cipherName: cipherInfo ? cipherInfo.name : null,
        group: context.selected_group,
        groupName: context.selected_group === 29 ? "X25519" : context.selected_group === 23 ? "P-256" : context.selected_group === 24 ? "P-384" : null,
        signatureAlgorithm: context.selected_signature_algorithm,
        alpn: context.selected_alpn,
        sni: context.selected_sni || context.local_sni,
        resumed: context.isResumed,
        helloRetried: context.helloRetried,
        handshakeDuration: context.handshakeEndTime && context.handshakeStartTime ? context.handshakeEndTime - context.handshakeStartTime : null
      };
    },
    /** Compute JA3 fingerprint from the ClientHello (server-side only).
     *  Returns { hash, raw } or null if no ClientHello available.
     *  JA3 = md5(SSLVersion,Ciphers,Extensions,EllipticCurves,EllipticCurvePointFormats)
     */
    getJA3: function() {
      if (!context.rawClientHello) return null;
      try {
        let hello = parse_tls_message(context.rawClientHello);
        let version = hello.client_version || 771;
        let ciphers = (hello.cipher_suites || []).filter((c) => (c & 3855) !== 2570).join("-");
        let extensions = (hello.extensions || []).map((e) => e.type).filter((t) => t !== 2570).join("-");
        let curves = (hello.supported_groups || []).filter((g) => (g & 3855) !== 2570).join("-");
        let pointFormats = (hello.ec_point_formats || [0]).join("-");
        let raw = [version, ciphers, extensions, curves, pointFormats].join(",");
        let hash = createHash("md5").update(raw).digest("hex");
        return { hash, raw };
      } catch (e) {
        return null;
      }
    },
    /** Request a TLS 1.3 Key Update. requestPeer=true means ask the other side to update too. */
    requestKeyUpdate: function(requestPeer) {
      if (context.state !== "connected" || context.selected_version !== TLS_VERSION.TLS1_3 && context.selected_version !== DTLS_VERSION.DTLS1_3) return;
      let hashName = negotiated_hash();
      let hashLen = getHashLen(hashName);
      let newLocalSecret = hkdf_expand_label(hashName, context.local_app_traffic_secret, "traffic upd", new Uint8Array(0, label_prefix()), hashLen);
      context.local_app_traffic_secret = newLocalSecret;
      let ku_data = build_tls_message({ type: "key_update", request_update: requestPeer ? 1 : 0 });
      ev.emit("message", 2, context.message_sent_seq, "key_update", ku_data);
      context.message_sent_seq++;
      ev.emit("keyUpdate", { direction: "send", secret: newLocalSecret });
    }
  };
  for (let k in api) if (Object.prototype.hasOwnProperty.call(api, k)) this[k] = api[k];
  Object.defineProperty(this, "isResumed", { get: function() {
    return context.isResumed;
  }, configurable: true, enumerable: true });
  return this;
}
var tls_session_default = TLSSession;

// node_modules/quico/node_modules/lemon-tls/src/record.js
function getAeadAlgo(cipherSuite) {
  if (cipherSuite != null) {
    let info = TLS_CIPHER_SUITES[cipherSuite];
    if (info && info.cipher === "CHACHA20_POLY1305") return "chacha20-poly1305";
    if (info && info.keylen === 32) return "aes-256-gcm";
  }
  return "aes-128-gcm";
}
function deriveKeys(trafficSecret, cipherSuite, labelPrefix) {
  const empty = new Uint8Array(0);
  let cs = TLS_CIPHER_SUITES[cipherSuite];
  return {
    key: hkdf_expand_label(cs.hash, trafficSecret, "key", empty, cs.keylen, labelPrefix),
    iv: hkdf_expand_label(cs.hash, trafficSecret, "iv", empty, 12, labelPrefix)
  };
}
function getNonce(iv, seq) {
  const nonce = new Uint8Array(12);
  nonce[0] = iv[0];
  nonce[1] = iv[1];
  nonce[2] = iv[2];
  nonce[3] = iv[3];
  const hi = seq / 4294967296 | 0;
  const lo = seq >>> 0;
  nonce[4] = iv[4] ^ hi >>> 24 & 255;
  nonce[5] = iv[5] ^ hi >>> 16 & 255;
  nonce[6] = iv[6] ^ hi >>> 8 & 255;
  nonce[7] = iv[7] ^ hi & 255;
  nonce[8] = iv[8] ^ lo >>> 24 & 255;
  nonce[9] = iv[9] ^ lo >>> 16 & 255;
  nonce[10] = iv[10] ^ lo >>> 8 & 255;
  nonce[11] = iv[11] ^ lo & 255;
  return nonce;
}
function getNonceInto(out, iv, seq) {
  out[0] = iv[0];
  out[1] = iv[1];
  out[2] = iv[2];
  out[3] = iv[3];
  const hi = seq / 4294967296 | 0;
  const lo = seq >>> 0;
  out[4] = iv[4] ^ hi >>> 24 & 255;
  out[5] = iv[5] ^ hi >>> 16 & 255;
  out[6] = iv[6] ^ hi >>> 8 & 255;
  out[7] = iv[7] ^ hi & 255;
  out[8] = iv[8] ^ lo >>> 24 & 255;
  out[9] = iv[9] ^ lo >>> 16 & 255;
  out[10] = iv[10] ^ lo >>> 8 & 255;
  out[11] = iv[11] ^ lo & 255;
  return out;
}
function encryptRecord(innerType, plaintext, key, nonce, algo) {
  const ptLen = plaintext.length;
  const recLen = ptLen + 1 + 16;
  const aad = new Uint8Array(5);
  aad[0] = 23;
  aad[1] = 3;
  aad[2] = 3;
  aad[3] = recLen >>> 8 & 255;
  aad[4] = recLen & 255;
  if (!algo) algo = key.length === 16 ? "aes-128-gcm" : "aes-256-gcm";
  const isChaCha = algo === "chacha20-poly1305";
  const cipher = browser_crypto_shim_default.createCipheriv(algo, key, nonce, isChaCha ? { authTagLength: 16 } : void 0);
  cipher.setAAD(aad, isChaCha ? { plaintextLength: ptLen + 1 } : void 0);
  const ct1 = cipher.update(plaintext);
  const innerBuf = new Uint8Array(1);
  innerBuf[0] = innerType;
  const ct2 = cipher.update(innerBuf);
  cipher.final();
  const tag = cipher.getAuthTag();
  const out = new Uint8Array(ct1.length + ct2.length + tag.length);
  out.set(ct1, 0);
  if (ct2.length > 0) out.set(ct2, ct1.length);
  out.set(tag, ct1.length + ct2.length);
  return out;
}
var _INNER_TYPE_BUFS = new Array(256);
for (let i = 0; i < 256; i++) {
  const b = new Uint8Array(1);
  b[0] = i;
  _INNER_TYPE_BUFS[i] = b;
}
function encryptCompleteRecord13(innerType, plaintext, key, nonce, algo, version) {
  const ptLen = plaintext.length;
  const payloadLen = ptLen + 1 + 16;
  const ver = version || 771;
  const rec = Buffer.allocUnsafe(5 + payloadLen);
  rec[0] = 23;
  rec[1] = ver >>> 8 & 255;
  rec[2] = ver & 255;
  rec[3] = payloadLen >>> 8 & 255;
  rec[4] = payloadLen & 255;
  if (plaintext.length > 0) {
    if (plaintext.copy) plaintext.copy(rec, 5);
    else rec.set(plaintext, 5);
  }
  rec[5 + ptLen] = innerType & 255;
  if (!algo) algo = key.length === 16 ? "aes-128-gcm" : "aes-256-gcm";
  const isChaCha = algo === "chacha20-poly1305";
  const cipher = browser_crypto_shim_default.createCipheriv(algo, key, nonce, isChaCha ? { authTagLength: 16 } : void 0);
  cipher.setAAD(rec.subarray(0, 5), isChaCha ? { plaintextLength: ptLen + 1 } : void 0);
  const ct = cipher.update(rec.subarray(5, 5 + ptLen + 1));
  ct.copy(rec, 5);
  cipher.final();
  cipher.getAuthTag().copy(rec, 5 + ct.length);
  return rec;
}
function decryptRecord(ciphertext, key, nonce, algo) {
  const aad = new Uint8Array(5);
  aad[0] = 23;
  aad[1] = 3;
  aad[2] = 3;
  aad[3] = ciphertext.length >> 8 & 255;
  aad[4] = ciphertext.length & 255;
  const ct = ciphertext.subarray(0, ciphertext.length - 16);
  const tag = ciphertext.subarray(ciphertext.length - 16);
  if (!algo) algo = key.length === 16 ? "aes-128-gcm" : "aes-256-gcm";
  const isChaCha = algo === "chacha20-poly1305";
  const decipher = browser_crypto_shim_default.createDecipheriv(algo, key, nonce, isChaCha ? { authTagLength: 16 } : void 0);
  decipher.setAAD(aad, isChaCha ? { plaintextLength: ct.length } : void 0);
  decipher.setAuthTag(tag);
  const pt = decipher.update(ct);
  decipher.final();
  return pt;
}
function decryptRecordWithAadView(aadView, ciphertext, key, nonce, algo) {
  const ct = ciphertext.subarray(0, ciphertext.length - 16);
  const tag = ciphertext.subarray(ciphertext.length - 16);
  if (!algo) algo = key.length === 16 ? "aes-128-gcm" : "aes-256-gcm";
  const isChaCha = algo === "chacha20-poly1305";
  const decipher = browser_crypto_shim_default.createDecipheriv(algo, key, nonce, isChaCha ? { authTagLength: 16 } : void 0);
  decipher.setAAD(aadView, isChaCha ? { plaintextLength: ct.length } : void 0);
  decipher.setAuthTag(tag);
  const pt = decipher.update(ct);
  decipher.final();
  return pt;
}
function encrypt12(pt, key, salt4, seqNum, recordType) {
  const hi = seqNum / 4294967296 | 0;
  const lo = seqNum >>> 0;
  const nonce = new Uint8Array(12);
  nonce[0] = salt4[0];
  nonce[1] = salt4[1];
  nonce[2] = salt4[2];
  nonce[3] = salt4[3];
  nonce[4] = hi >>> 24 & 255;
  nonce[5] = hi >>> 16 & 255;
  nonce[6] = hi >>> 8 & 255;
  nonce[7] = hi & 255;
  nonce[8] = lo >>> 24 & 255;
  nonce[9] = lo >>> 16 & 255;
  nonce[10] = lo >>> 8 & 255;
  nonce[11] = lo & 255;
  const aad = new Uint8Array(13);
  aad[0] = nonce[4];
  aad[1] = nonce[5];
  aad[2] = nonce[6];
  aad[3] = nonce[7];
  aad[4] = nonce[8];
  aad[5] = nonce[9];
  aad[6] = nonce[10];
  aad[7] = nonce[11];
  aad[8] = recordType & 255;
  aad[9] = 3;
  aad[10] = 3;
  aad[11] = pt.length >>> 8 & 255;
  aad[12] = pt.length & 255;
  const algo = key.length === 16 ? "aes-128-gcm" : "aes-256-gcm";
  const cipher = browser_crypto_shim_default.createCipheriv(algo, key, nonce);
  cipher.setAAD(aad);
  const ct = cipher.update(pt);
  cipher.final();
  const tag = cipher.getAuthTag();
  const out = new Uint8Array(8 + ct.length + tag.length);
  out[0] = nonce[4];
  out[1] = nonce[5];
  out[2] = nonce[6];
  out[3] = nonce[7];
  out[4] = nonce[8];
  out[5] = nonce[9];
  out[6] = nonce[10];
  out[7] = nonce[11];
  out.set(ct, 8);
  out.set(tag, 8 + ct.length);
  return out;
}
function encryptCompleteRecord12(pt, key, salt4, seqNum, recordType, version) {
  const ptLen = pt.length;
  const bodyLen = 8 + ptLen + 16;
  const ver = version || 771;
  const rec = Buffer.allocUnsafe(5 + bodyLen);
  rec[0] = recordType & 255;
  rec[1] = ver >>> 8 & 255;
  rec[2] = ver & 255;
  rec[3] = bodyLen >>> 8 & 255;
  rec[4] = bodyLen & 255;
  const hi = seqNum / 4294967296 | 0;
  const lo = seqNum >>> 0;
  rec[5] = hi >>> 24 & 255;
  rec[6] = hi >>> 16 & 255;
  rec[7] = hi >>> 8 & 255;
  rec[8] = hi & 255;
  rec[9] = lo >>> 24 & 255;
  rec[10] = lo >>> 16 & 255;
  rec[11] = lo >>> 8 & 255;
  rec[12] = lo & 255;
  const nonce = new Uint8Array(12);
  nonce[0] = salt4[0];
  nonce[1] = salt4[1];
  nonce[2] = salt4[2];
  nonce[3] = salt4[3];
  nonce[4] = rec[5];
  nonce[5] = rec[6];
  nonce[6] = rec[7];
  nonce[7] = rec[8];
  nonce[8] = rec[9];
  nonce[9] = rec[10];
  nonce[10] = rec[11];
  nonce[11] = rec[12];
  const aad = new Uint8Array(13);
  aad[0] = rec[5];
  aad[1] = rec[6];
  aad[2] = rec[7];
  aad[3] = rec[8];
  aad[4] = rec[9];
  aad[5] = rec[10];
  aad[6] = rec[11];
  aad[7] = rec[12];
  aad[8] = recordType & 255;
  aad[9] = 3;
  aad[10] = 3;
  aad[11] = ptLen >>> 8 & 255;
  aad[12] = ptLen & 255;
  const algo = key.length === 16 ? "aes-128-gcm" : "aes-256-gcm";
  const cipher = browser_crypto_shim_default.createCipheriv(algo, key, nonce);
  cipher.setAAD(aad);
  const ct = cipher.update(pt);
  cipher.final();
  ct.copy(rec, 13);
  cipher.getAuthTag().copy(rec, 13 + ct.length);
  return rec;
}
function decrypt12(fragment, key, salt4, seqNum, recordType) {
  if (fragment.length < 24) throw new Error("TLS 1.2 fragment too short");
  const explicit = fragment.subarray(0, 8);
  const ct = fragment.subarray(8, fragment.length - 16);
  const tag = fragment.subarray(fragment.length - 16);
  const nonce = new Uint8Array(12);
  nonce[0] = salt4[0];
  nonce[1] = salt4[1];
  nonce[2] = salt4[2];
  nonce[3] = salt4[3];
  nonce[4] = explicit[0];
  nonce[5] = explicit[1];
  nonce[6] = explicit[2];
  nonce[7] = explicit[3];
  nonce[8] = explicit[4];
  nonce[9] = explicit[5];
  nonce[10] = explicit[6];
  nonce[11] = explicit[7];
  const aad = new Uint8Array(13);
  const hi = seqNum / 4294967296 | 0;
  const lo = seqNum >>> 0;
  aad[0] = hi >>> 24 & 255;
  aad[1] = hi >>> 16 & 255;
  aad[2] = hi >>> 8 & 255;
  aad[3] = hi & 255;
  aad[4] = lo >>> 24 & 255;
  aad[5] = lo >>> 16 & 255;
  aad[6] = lo >>> 8 & 255;
  aad[7] = lo & 255;
  aad[8] = recordType & 255;
  aad[9] = 3;
  aad[10] = 3;
  aad[11] = ct.length >>> 8 & 255;
  aad[12] = ct.length & 255;
  const algo = key.length === 16 ? "aes-128-gcm" : "aes-256-gcm";
  const decipher = browser_crypto_shim_default.createDecipheriv(algo, key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const pt = decipher.update(ct);
  decipher.final();
  return pt;
}
function deriveKeys12(masterSecret, localRandom, remoteRandom, cipherSuite, isServer) {
  if (isServer) {
    let d = tls_derive_from_master_secret_tls12(masterSecret, localRandom, remoteRandom, cipherSuite);
    return { readKey: d.client_key, readIv: d.client_iv, writeKey: d.server_key, writeIv: d.server_iv };
  } else {
    let d = tls_derive_from_master_secret_tls12(masterSecret, remoteRandom, localRandom, cipherSuite);
    return { readKey: d.server_key, readIv: d.server_iv, writeKey: d.client_key, writeIv: d.client_iv };
  }
}
function writeRecord(transport, type, payload, version) {
  if (!transport || typeof transport.write !== "function") return false;
  const ver = version || 771;
  const plen = payload.length;
  const rec = Buffer.allocUnsafe(5 + plen);
  rec[0] = type;
  rec[1] = ver >>> 8 & 255;
  rec[2] = ver & 255;
  rec[3] = plen >>> 8 & 255;
  rec[4] = plen & 255;
  rec.set(payload, 5);
  return transport.write(rec);
}

// node_modules/quico/node_modules/lemon-tls/src/tls_socket.js
var SIGALG_NAMES = {
  1025: "rsa_pkcs1_sha256",
  1281: "rsa_pkcs1_sha384",
  1537: "rsa_pkcs1_sha512",
  1027: "ecdsa_secp256r1_sha256",
  1283: "ecdsa_secp384r1_sha384",
  1539: "ecdsa_secp521r1_sha512",
  2052: "rsa_pss_rsae_sha256",
  2053: "rsa_pss_rsae_sha384",
  2054: "rsa_pss_rsae_sha512",
  2055: "ed25519",
  2056: "ed448",
  2057: "rsa_pss_pss_sha256",
  2058: "rsa_pss_pss_sha384",
  2059: "rsa_pss_pss_sha512"
};
function sigalgCodeToName(code) {
  return SIGALG_NAMES[code] || `0x${code.toString(16).padStart(4, "0")}`;
}
function toBuf(u82) {
  return Buffer.isBuffer(u82) ? u82 : Buffer.from(u82 || []);
}
function parseVersion(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    let s = v.toUpperCase().replace(/[^0-9.]/g, "");
    if (s === "1.3" || s === "13") return 772;
    if (s === "1.2" || s === "12") return 771;
    if (s === "1.1" || s === "11") return 770;
    if (s === "1.0" || s === "10") return 769;
  }
  return null;
}
function TLSSocket(duplex, options) {
  if (!(this instanceof TLSSocket)) return new TLSSocket(duplex, options);
  options = options || {};
  Duplex.call(this, {
    allowHalfOpen: true,
    readableObjectMode: false,
    writableObjectMode: false,
    highWaterMark: 256 * 1024
  });
  const self2 = this;
  let _ticketKeys = options.ticketKeys ? Buffer.from(options.ticketKeys) : browser_crypto_shim_default.randomBytes(48);
  let context = {
    options,
    // External transport (Duplex)
    transport: duplex && typeof duplex.write === "function" ? duplex : null,
    // Internal TLSSession
    session: new tls_session_default({
      isServer: !!options.isServer,
      servername: options.servername,
      ALPNProtocols: options.ALPNProtocols || null,
      SNICallback: options.SNICallback || null,
      ticketKeys: _ticketKeys,
      ticketLifetime: options.ticketLifetime,
      session: options.session || null,
      psk: options.psk || null,
      rejectUnauthorized: options.rejectUnauthorized,
      ca: options.ca || null,
      sessionTickets: options.sessionTickets,
      maxHandshakeSize: options.maxHandshakeSize || 0,
      customExtensions: options.customExtensions || [],
      requestCert: !!options.requestCert,
      cert: options.cert || null,
      key: options.key || null
    }),
    // Handshake write
    handshake_write_key: null,
    handshake_write_iv: null,
    handshake_write_seq: 0,
    handshake_write_aead: null,
    // Handshake read
    handshake_read_key: null,
    handshake_read_iv: null,
    handshake_read_seq: 0,
    handshake_read_aead: null,
    // Application write
    app_write_key: null,
    app_write_iv: null,
    app_write_seq: 0,
    app_write_aead: null,
    // Application read
    app_read_key: null,
    app_read_iv: null,
    app_read_seq: 0,
    app_read_aead: null,
    // Reusable 12-byte nonce scratch buffers — one per direction. Populated
    // in-place per record from (iv XOR seq) and handed to createCipheriv which
    // copies it into OpenSSL state. Saves 12-byte allocation per record —
    // ~7.7KB per 10MB transfer, less GC pressure.
    _nonceEncScratch: new Uint8Array(12),
    _nonceDecScratch: new Uint8Array(12),
    using_app_keys: false,
    remote_ccs_seen: false,
    local_ccs_sent: false,
    // Middlebox-compatibility CCS (TLS 1.3, RFC 8446 §D.4). This is a record-
    // layer artifact — a single 0x01 byte sent as a plaintext CCS record so
    // legacy middleboxes see a "cipher change" and let the flow through. It
    // is NEVER a handshake message; TLSSession neither sends nor receives it.
    // That is exactly why it lives here and not in the session: the QUIC
    // consumer drives TLSSession directly, and RFC 9001 §8.4 forbids CCS in
    // QUIC — keeping this in the TCP record layer means QUIC can never emit it.
    tls13_compat_ccs_sent: false,
    tls12_read_seq: 0,
    // Record-layer abuse limits. A peer that never advances the handshake but
    // keeps us parsing is a denial of service even though every individual
    // record is well formed, so the limit belongs at the record layer where
    // the records are counted — not in any one message handler.
    consecutive_empty_records: 0,
    consecutive_ccs_records: 0,
    // Buffers and queues.
    //
    // readBuffer is a growable receive buffer with two offsets:
    //   - readStart: next byte to be parsed (advanced as records are consumed)
    //   - readEnd:   next byte to be written by an incoming chunk
    //
    // When readStart === readEnd the buffer is fully drained; both reset to 0 and
    // the underlying Buffer is reused (no reallocation). When a new chunk can't fit
    // at the end we compact by moving the unread portion back to 0. Only when that
    // still isn't enough do we double the buffer capacity.
    //
    // This gives O(N) total copy cost regardless of how data fragments across TCP
    // chunks — versus the quadratic cost of `readBuffer = Buffer.concat([...])`.
    // Initial 64KB capacity — fits 4 full TLS records (16KB each) or the entire
    // handshake transcript for most certs. Avoids the first ~3 grow-and-copy
    // cycles when readBuffer starts at 0 and an inbound 16KB chunk forces
    // immediate doubling from 0→64KB across 3 reallocs. For short-lived
    // connections (HTTP request/response), this single upfront allocation
    // commonly means ZERO readBuffer resizes during the connection's lifetime.
    readBuffer: Buffer.allocUnsafe(65536),
    readStart: 0,
    readEnd: 0,
    // Handshake MESSAGE stream buffer (distinct from readBuffer, which is the
    // record stream). RFC 8446 §5.1: handshake messages may be coalesced into
    // one record or fragmented across records — record boundaries carry no
    // meaning at the message layer. Record payloads are appended here and
    // complete messages are carved out by their own 4-byte type+length
    // header. Without this, a record carrying EE+Cert+CV+Finished (as
    // OpenSSL/BoringSSL routinely pack) fed only its FIRST message to the
    // session and silently dropped the rest.
    hsBuf: null,
    appWriteQueue: [],
    pendingHandshake: [],
    // General state
    destroyed: false,
    secureEstablished: false,
    aeadAlgo: null,
    // set when cipher suite is negotiated
    // Session ticket keys for PSK resumption
    ticketKeys: _ticketKeys,
    // Advanced options
    maxRecordSize: options.maxRecordSize || 16384,
    sessionTickets: options.sessionTickets !== false,
    pins: options.pins || null,
    // ['sha256/AAAA...'] certificate pinning
    handshakeTimeout: options.handshakeTimeout || 0,
    // ms, 0 = no timeout
    allowedCipherSuites: options.allowedCipherSuites || null,
    // [0x1301, ...] whitelist
    certificateCallback: options.certificateCallback || null,
    // (info, cb) => cb(null, ctx)
    handshakeTimer: null,
    // legacy record version
    rec_version: 771
  };
  let session = context.session;
  function writeRecord2(type, payload) {
    if (!context.transport) throw new Error("No transport attached to TLSSocket");
    if (context.destroyed || context.transport.destroyed || context.transport.writableEnded) return false;
    try {
      return writeRecord(context.transport, type, payload, context.rec_version);
    } catch (e) {
      self2.emit("error", e);
      return false;
    }
  }
  const MAX_RECORD_PLAINTEXT = 16384;
  function writeAppData(plain) {
    const total = plain.length;
    const maxSize = context.maxRecordSize || MAX_RECORD_PLAINTEXT;
    if (total > maxSize) {
      const t = context.transport;
      const corkable = t && typeof t.cork === "function" && typeof t.uncork === "function";
      if (corkable) t.cork();
      let lastOk = true;
      try {
        for (let off = 0; off < total; off += maxSize) {
          const endOff = off + maxSize > total ? total : off + maxSize;
          if (!writeAppDataSingle(plain.subarray(off, endOff))) lastOk = false;
        }
      } finally {
        if (corkable) t.uncork();
      }
      return lastOk;
    }
    return writeAppDataSingle(plain);
  }
  function writeAppDataSingle(plain) {
    if (context.destroyed || !context.transport) return false;
    const t = context.transport;
    if (t.destroyed || t.writableEnded) return false;
    if (context.isTls13) {
      if (context.app_write_key === null) {
        const ts = session.getTrafficSecrets();
        if (ts.localAppSecret === null) return true;
        const d = deriveKeys(ts.localAppSecret, ts.cipher);
        context.app_write_key = d.key;
        context.app_write_iv = d.iv;
      }
      const algo = context.aeadAlgo || getAeadAlgo(session.getCipher());
      try {
        const rec = encryptCompleteRecord13(
          TLS_CONTENT_TYPE.APPLICATION_DATA,
          plain,
          context.app_write_key,
          getNonceInto(context._nonceEncScratch, context.app_write_iv, context.app_write_seq),
          algo,
          context.rec_version
        );
        context.app_write_seq++;
        return t.write(rec);
      } catch (e) {
        self2.emit("error", e);
        return false;
      }
    } else {
      if (context.app_write_key === null) {
        const ts = session.getTrafficSecrets();
        const d12 = deriveKeys12(ts.masterSecret, ts.localRandom, ts.remoteRandom, ts.cipher, ts.isServer);
        context.app_write_key = d12.writeKey;
        context.app_write_iv = d12.writeIv;
      }
      try {
        const rec = encryptCompleteRecord12(
          plain,
          context.app_write_key,
          context.app_write_iv,
          context.app_write_seq,
          TLS_CONTENT_TYPE.APPLICATION_DATA,
          context.rec_version
        );
        context.app_write_seq++;
        return t.write(rec);
      } catch (e) {
        self2.emit("error", e);
        return false;
      }
    }
  }
  function processCiphertext(body, header) {
    let out = null;
    const isTls13 = context.isTls13 !== void 0 ? context.isTls13 : session.getVersion() === 772;
    try {
      if (!isTls13 && context.remote_ccs_seen === true) {
        if (context.app_read_key === null) {
          const ts = session.getTrafficSecrets();
          if (!ts.masterSecret) {
            self2.emit("error", new Error("Received encrypted record before master_secret derived"));
            return;
          }
          const d12 = deriveKeys12(ts.masterSecret, ts.localRandom, ts.remoteRandom, ts.cipher, ts.isServer);
          context.app_read_key = d12.readKey;
          context.app_read_iv = d12.readIv;
          context.app_write_key = d12.writeKey;
          context.app_write_iv = d12.writeIv;
        }
        const recordType = context.using_app_keys ? 23 : 22;
        out = decrypt12(body, context.app_read_key, context.app_read_iv, context.tls12_read_seq, recordType);
      } else if (isTls13 && context.using_app_keys === true) {
        if (context.app_read_key === null) {
          const ts = session.getTrafficSecrets();
          if (ts.remoteAppSecret === null) return;
          const d = deriveKeys(ts.remoteAppSecret, ts.cipher);
          context.app_read_key = d.key;
          context.app_read_iv = d.iv;
        }
        const algo = context.aeadAlgo || getAeadAlgo(session.getCipher());
        const nonce = getNonceInto(context._nonceDecScratch, context.app_read_iv, context.app_read_seq);
        if (header !== void 0) {
          out = decryptRecordWithAadView(header, body, context.app_read_key, nonce, algo);
        } else {
          out = decryptRecord(body, context.app_read_key, nonce, algo);
        }
        context.app_read_seq++;
      } else if (isTls13) {
        if (context.handshake_read_key === null) {
          const hs = session.getHandshakeSecrets();
          if (hs.remoteSecret === null || hs.cipher === null) return;
          const d = deriveKeys(hs.remoteSecret, hs.cipher);
          context.handshake_read_key = d.key;
          context.handshake_read_iv = d.iv;
        }
        const algo = context.aeadAlgo || getAeadAlgo(session.getCipher());
        const nonce = getNonceInto(context._nonceDecScratch, context.handshake_read_iv, context.handshake_read_seq);
        if (header !== void 0) {
          out = decryptRecordWithAadView(header, body, context.handshake_read_key, nonce, algo);
        } else {
          out = decryptRecord(body, context.handshake_read_key, nonce, algo);
        }
        context.handshake_read_seq++;
      }
    } catch (e) {
      try {
        session.sendAlert ? session.sendAlert(2, TLS_ALERT.BAD_RECORD_MAC) : null;
      } catch (_) {
      }
      self2.emit("error", new Error("TLS record decryption failed (bad_record_mac)"));
      self2.destroy();
      return;
    }
    if (out !== null) {
      if (isTls13) {
        let j = out.length - 1;
        while (j >= 0 && out[j] === 0) j--;
        if (j < 0) {
          self2.emit("error", new Error("Malformed TLSInnerPlaintext"));
          return;
        }
        const content_type = out[j];
        if (content_type === TLS_CONTENT_TYPE.APPLICATION_DATA) {
          self2.push(out.subarray(0, j));
        } else if (content_type === TLS_CONTENT_TYPE.HANDSHAKE) {
          feedHandshakeBytes(out.subarray(0, j));
        } else if (content_type === TLS_CONTENT_TYPE.ALERT) {
        }
      } else {
        if (context.using_app_keys === true) {
          self2.push(out);
        } else {
          feedHandshakeBytes(out);
        }
      }
    }
  }
  function _appendChunk(chunk) {
    const rb = context.readBuffer;
    const readStart = context.readStart;
    const readEnd = context.readEnd;
    const chunkLen = chunk.length;
    if (readEnd + chunkLen <= rb.length) {
      chunk.copy(rb, readEnd);
      context.readEnd = readEnd + chunkLen;
      return;
    }
    const unread = readEnd - readStart;
    const needed = unread + chunkLen;
    if (needed <= rb.length) {
      if (readStart > 0 && unread > 0) rb.copy(rb, 0, readStart, readEnd);
      chunk.copy(rb, unread);
      context.readStart = 0;
      context.readEnd = needed;
      return;
    }
    let newSize = rb.length > 0 ? rb.length * 2 : 8192;
    while (newSize < needed) newSize *= 2;
    const newBuf = Buffer.allocUnsafe(newSize);
    if (unread > 0) rb.copy(newBuf, 0, readStart, readEnd);
    chunk.copy(newBuf, unread);
    context.readBuffer = newBuf;
    context.readStart = 0;
    context.readEnd = needed;
  }
  function feedHandshakeBytes(bytes) {
    if (context.hsBuf === null || context.hsBuf.length === 0) {
      context.hsBuf = Buffer.from(bytes);
    } else {
      context.hsBuf = Buffer.concat([context.hsBuf, Buffer.from(bytes)]);
    }
    while (context.hsBuf.length >= 4) {
      const len = context.hsBuf[1] << 16 | context.hsBuf[2] << 8 | context.hsBuf[3];
      if (context.hsBuf.length < 4 + len) break;
      const msg = context.hsBuf.subarray(0, 4 + len);
      context.hsBuf = context.hsBuf.subarray(4 + len);
      session.message(msg);
      if (context.destroyed) return;
    }
  }
  function parseRecordsAndDispatch() {
    const rb = context.readBuffer;
    let off = context.readStart;
    const end = context.readEnd;
    while (end - off >= 5) {
      if (context.destroyed || session && session.getState && (session.getState() === "error" || session.getState() === "closed")) {
        return;
      }
      const type = rb[off];
      const len = rb[off + 3] << 8 | rb[off + 4];
      if (end - off < 5 + len) break;
      const header = rb.subarray(off, off + 5);
      const body = rb.subarray(off + 5, off + 5 + len);
      off += 5 + len;
      const recVer = rb[off - len - 5 + 1] << 8 | rb[off - len - 5 + 2];
      if (recVer >>> 8 !== 3) {
        try {
          session.sendAlert(2, TLS_ALERT.PROTOCOL_VERSION);
        } catch (e) {
        }
        self2.emit("error", new Error("Record with illegal legacy_record_version 0x" + recVer.toString(16)));
        markTransportDead();
        if (context.transport && !context.transport.destroyed) context.transport.destroy();
        return;
      }
      if (len === 0) {
        if (++context.consecutive_empty_records > 32) {
          try {
            session.sendAlert(2, TLS_ALERT.UNEXPECTED_MESSAGE);
          } catch (e) {
          }
          self2.emit("error", new Error("Too many consecutive empty records"));
          markTransportDead();
          if (context.transport && !context.transport.destroyed) context.transport.destroy();
          return;
        }
      } else {
        context.consecutive_empty_records = 0;
      }
      if (type === TLS_CONTENT_TYPE.CHANGE_CIPHER_SPEC) {
        if (++context.consecutive_ccs_records > 8) {
          try {
            session.sendAlert(2, TLS_ALERT.UNEXPECTED_MESSAGE);
          } catch (e) {
          }
          self2.emit("error", new Error("Too many consecutive ChangeCipherSpec records"));
          markTransportDead();
          if (context.transport && !context.transport.destroyed) context.transport.destroy();
          return;
        }
      } else {
        context.consecutive_ccs_records = 0;
      }
      if (type === TLS_CONTENT_TYPE.APPLICATION_DATA) {
        processCiphertext(body, header);
        context.tls12_read_seq++;
      } else if (type === TLS_CONTENT_TYPE.HANDSHAKE) {
        if (context.remote_ccs_seen === true) {
          processCiphertext(body, header);
        } else {
          feedHandshakeBytes(body);
        }
        context.tls12_read_seq++;
      } else if (type === TLS_CONTENT_TYPE.CHANGE_CIPHER_SPEC) {
        const ccsVersion = context.isTls13 !== void 0 ? context.isTls13 ? 772 : 771 : session.getVersion();
        if (ccsVersion === 771) {
          context.tls12_read_seq = 0;
          context.remote_ccs_seen = true;
        }
      } else if (type === TLS_CONTENT_TYPE.ALERT) {
        if (body.length >= 2) {
          const level = body[0];
          const desc = body[1];
          self2.emit("alert", { level, description: desc });
          if (desc === TLS_ALERT.CLOSE_NOTIFY) {
            session.close();
            if (context.transport && typeof context.transport.end === "function") {
              context.transport.end();
            }
          }
          if (level === TLS_ALERT_LEVEL.FATAL) {
            if (context.transport && typeof context.transport.destroy === "function") {
              context.transport.destroy();
            }
          }
        }
      }
    }
    if (off >= end) {
      context.readStart = 0;
      context.readEnd = 0;
    } else {
      context.readStart = off;
    }
  }
  function canWrite() {
    const t = context.transport;
    return !!t && !context.destroyed && !t.destroyed && !t.writableEnded && t.writable !== false;
  }
  function sendCompatCCS() {
    if (context.tls13_compat_ccs_sent) return false;
    context.tls13_compat_ccs_sent = true;
    writeRecord2(TLS_CONTENT_TYPE.CHANGE_CIPHER_SPEC, Buffer.from([1]));
    return true;
  }
  function markTransportDead() {
    if (context.destroyed) return;
    context.destroyed = true;
    try {
      session.close();
    } catch (e) {
    }
  }
  function bindTransport() {
    if (!context.transport) return;
    context.transport.on("data", function(chunk) {
      _appendChunk(chunk);
      parseRecordsAndDispatch();
    });
    context.transport.on("error", function(err) {
      markTransportDead();
      self2.emit("error", err);
    });
    context.transport.on("close", function() {
      markTransportDead();
      self2.emit("close");
    });
  }
  session.on("message", function(epoch, seq, type, data) {
    const buf = toBuf(data || []);
    const isTls13 = context.isTls13 !== void 0 ? context.isTls13 : session.getVersion() === 772;
    if (type === "alert") {
      if (epoch === 0) {
        writeRecord2(TLS_CONTENT_TYPE.ALERT, buf);
        return;
      }
      if (isTls13) {
        if (epoch === 2 && context.app_write_key === null) {
          const ts = session.getTrafficSecrets();
          if (ts && ts.localAppSecret) {
            const d = deriveKeys(ts.localAppSecret, ts.cipher);
            context.app_write_key = d.key;
            context.app_write_iv = d.iv;
          }
        } else if (epoch === 1 && !context.handshake_write_key) {
          const ts = session.getTrafficSecrets();
          if (ts && ts.localHandshakeSecret) {
            const d = deriveKeys(ts.localHandshakeSecret, ts.cipher);
            context.handshake_write_key = d.key;
            context.handshake_write_iv = d.iv;
            if (context.handshake_write_seq === void 0 || context.handshake_write_seq === null) {
              context.handshake_write_seq = 0;
            }
          }
        }
        const writeKey = epoch === 2 ? context.app_write_key : context.handshake_write_key;
        const writeIv = epoch === 2 ? context.app_write_iv : context.handshake_write_iv;
        const writeSeq = epoch === 2 ? context.app_write_seq : context.handshake_write_seq;
        if (!writeKey) {
          self2.emit("error", new Error(
            "TLS 1.3: cannot protect an alert at epoch " + epoch + " \u2014 no write key available; alert not sent"
          ));
          return;
        }
        if (!session.isServer) sendCompatCCS();
        const algo = context.aeadAlgo || getAeadAlgo(session.getCipher());
        const enc = encryptRecord(TLS_CONTENT_TYPE.ALERT, buf, writeKey, getNonce(writeIv, writeSeq), algo);
        if (epoch === 2) context.app_write_seq++;
        else context.handshake_write_seq++;
        writeRecord2(TLS_CONTENT_TYPE.APPLICATION_DATA, enc);
      } else {
        if (!context.app_write_key) {
          self2.emit("error", new Error(
            "TLS 1.2: cannot protect an alert after CCS \u2014 no application write key; alert not sent"
          ));
          return;
        }
        const fragment = encrypt12(
          buf,
          context.app_write_key,
          context.app_write_iv,
          context.app_write_seq,
          TLS_CONTENT_TYPE.ALERT
        );
        context.app_write_seq++;
        writeRecord2(TLS_CONTENT_TYPE.ALERT, fragment);
      }
      return;
    }
    if (epoch === 0) {
      if (!context.transport) {
        context.pendingHandshake.push({ type: TLS_CONTENT_TYPE.HANDSHAKE, data: buf });
        return;
      }
      if (!session.isServer && type === "hello" && session.getVersion() === 772) {
        sendCompatCCS();
      }
      writeRecord2(TLS_CONTENT_TYPE.HANDSHAKE, buf);
      if (session.isServer && (type === "hello" || type === "hello_retry_request") && session.getVersion() === 772) {
        sendCompatCCS();
      }
      return;
    }
    if (epoch === 1) {
      if (isTls13) {
        if (!session.isServer) sendCompatCCS();
        if (context.handshake_write_key === null) {
          const hs = session.getHandshakeSecrets();
          if (hs.localSecret === null) {
            self2.emit("error", new Error("Missing handshake write keys"));
            return;
          }
          const d = deriveKeys(hs.localSecret, hs.cipher);
          context.handshake_write_key = d.key;
          context.handshake_write_iv = d.iv;
        }
        const algo = context.aeadAlgo || getAeadAlgo(session.getCipher());
        try {
          const rec = encryptCompleteRecord13(
            TLS_CONTENT_TYPE.HANDSHAKE,
            buf,
            context.handshake_write_key,
            getNonceInto(context._nonceEncScratch, context.handshake_write_iv, context.handshake_write_seq),
            algo,
            context.rec_version
          );
          context.handshake_write_seq++;
          if (canWrite()) {
            context.transport.write(rec);
          }
        } catch (e) {
          self2.emit("error", e);
        }
      } else {
        if (context.local_ccs_sent === false) {
          writeRecord2(TLS_CONTENT_TYPE.CHANGE_CIPHER_SPEC, Buffer.from([1]));
          context.local_ccs_sent = true;
          context.app_write_seq = 0;
        }
        if (context.app_write_key === null) {
          const ts = session.getTrafficSecrets();
          const d12 = deriveKeys12(ts.masterSecret, ts.localRandom, ts.remoteRandom, ts.cipher, ts.isServer);
          context.app_read_key = d12.readKey;
          context.app_read_iv = d12.readIv;
          context.app_write_key = d12.writeKey;
          context.app_write_iv = d12.writeIv;
        }
        try {
          const rec = encryptCompleteRecord12(
            buf,
            context.app_write_key,
            context.app_write_iv,
            context.app_write_seq,
            TLS_CONTENT_TYPE.HANDSHAKE,
            context.rec_version
          );
          context.app_write_seq++;
          if (canWrite()) {
            context.transport.write(rec);
          }
        } catch (e) {
          self2.emit("error", e);
        }
      }
    }
    if (epoch === 2) {
      if (!context.app_write_key) {
        const ts = session.getTrafficSecrets();
        if (ts.localAppSecret) {
          const d = deriveKeys(ts.localAppSecret, ts.cipher);
          context.app_write_key = d.key;
          context.app_write_iv = d.iv;
        }
      }
      if (context.app_write_key) {
        const algo = context.aeadAlgo || getAeadAlgo(session.getCipher());
        try {
          const rec = encryptCompleteRecord13(
            TLS_CONTENT_TYPE.HANDSHAKE,
            buf,
            context.app_write_key,
            getNonceInto(context._nonceEncScratch, context.app_write_iv, context.app_write_seq),
            algo,
            context.rec_version
          );
          context.app_write_seq++;
          if (canWrite()) {
            context.transport.write(rec);
          }
        } catch (e) {
          self2.emit("error", e);
        }
      }
      return;
    }
  });
  session.on("hello", function() {
    context.rec_version = 771;
    if (!session.isServer) return;
    let maxVer = parseVersion(options.maxVersion) || 772;
    let minVer = parseVersion(options.minVersion) || 771;
    let versions = [];
    if (maxVer >= 772 && minVer <= 772) versions.push(772);
    if (maxVer >= 771 && minVer <= 771) versions.push(771);
    if (versions.length === 0) versions.push(771);
    let ciphers = default_cipher_suites(versions.includes(772), versions.includes(771));
    let sigalgs = options.signatureAlgorithms || default_signature_schemes();
    let groups = options.groups || SUPPORTED_GROUPS.slice();
    if (options.prioritizeChaCha) {
      let chacha = ciphers.filter((c) => c === 4867 || c === 52392);
      let rest = ciphers.filter((c) => c !== 4867 && c !== 52392);
      ciphers = [...chacha, ...rest];
    }
    if (context.allowedCipherSuites) {
      ciphers = ciphers.filter((c) => context.allowedCipherSuites.includes(c));
    }
    let alpns = Array.isArray(options.ALPNProtocols) ? options.ALPNProtocols : [];
    session.set_context({
      local_supported_versions: versions,
      local_supported_alpns: alpns,
      local_supported_groups: groups,
      local_supported_cipher_suites: ciphers,
      local_supported_signature_algorithms: sigalgs
    });
    if (session.getCipher()) context.aeadAlgo = getAeadAlgo(session.getCipher());
    if (session.getVersion()) context.isTls13 = session.getVersion() === 772;
  });
  session.on("secureConnect", function() {
    if (context.hsBuf !== null && context.hsBuf.length > 0) {
      context.hsBuf = null;
      markTransportDead();
      self2.emit("error", new Error("Trailing data after handshake completion (decode_error)"));
      const t = context.transport;
      if (t && typeof t.destroy === "function" && !t.destroyed) t.destroy();
      return;
    }
    context.using_app_keys = true;
    context.secureEstablished = true;
    context.aeadAlgo = getAeadAlgo(session.getCipher());
    context.isTls13 = session.getVersion() === 772;
    if (context.handshakeTimer) {
      clearTimeout(context.handshakeTimer);
      context.handshakeTimer = null;
    }
    if (context.pins && context.pins.length > 0) {
      try {
        let cert = session.getPeerCertificate();
        if (cert && cert.raw) {
          let hash = "sha256/" + browser_crypto_shim_default.createHash("sha256").update(cert.raw).digest("base64");
          if (!context.pins.includes(hash)) {
            self2.emit("error", new Error("Certificate pin mismatch: " + hash));
            self2.destroy();
            return;
          }
        }
      } catch (e) {
      }
    }
    try {
      let ts = session.getTrafficSecrets();
      let clientRandom = Buffer.from(session.context.local_random || session.context.remote_random || []).toString("hex");
      if (session.isServer) clientRandom = Buffer.from(session.context.remote_random || []).toString("hex");
      if (session.getVersion() === 772) {
        let hs = session.getHandshakeSecrets();
        if (hs.localSecret) self2.emit("keylog", Buffer.from(`SERVER_HANDSHAKE_TRAFFIC_SECRET ${clientRandom} ${Buffer.from(session.isServer ? hs.localSecret : hs.remoteSecret).toString("hex")}
`));
        if (hs.remoteSecret) self2.emit("keylog", Buffer.from(`CLIENT_HANDSHAKE_TRAFFIC_SECRET ${clientRandom} ${Buffer.from(session.isServer ? hs.remoteSecret : hs.localSecret).toString("hex")}
`));
        if (ts.localAppSecret) self2.emit("keylog", Buffer.from(`SERVER_TRAFFIC_SECRET_0 ${clientRandom} ${Buffer.from(session.isServer ? ts.localAppSecret : ts.remoteAppSecret).toString("hex")}
`));
        if (ts.remoteAppSecret) self2.emit("keylog", Buffer.from(`CLIENT_TRAFFIC_SECRET_0 ${clientRandom} ${Buffer.from(session.isServer ? ts.remoteAppSecret : ts.localAppSecret).toString("hex")}
`));
      } else {
        if (ts.masterSecret) self2.emit("keylog", Buffer.from(`CLIENT_RANDOM ${clientRandom} ${Buffer.from(ts.masterSecret).toString("hex")}
`));
      }
    } catch (e) {
    }
    if (context.appWriteQueue.length > 0) {
      const t = context.transport;
      const corkable = t && typeof t.cork === "function" && typeof t.uncork === "function";
      if (corkable) t.cork();
      try {
        const q = context.appWriteQueue;
        context.appWriteQueue = [];
        for (let i = 0; i < q.length; i++) writeAppData(q[i]);
      } finally {
        if (corkable) t.uncork();
      }
    }
    self2.emit("secureConnect");
  });
  let _lastSessionBuffer;
  session.on("session", function(ticketData) {
    _lastSessionBuffer = Buffer.isBuffer(ticketData) ? ticketData : Buffer.from(ticketData);
    self2.emit("session", ticketData);
  });
  session.on("error", function(err) {
    markTransportDead();
    self2.emit("error", err);
    const t = context.transport;
    if (t && typeof t.destroy === "function" && !t.destroyed) t.destroy();
  });
  session.on("handshakeMessage", function(type, raw, parsed) {
    self2.emit("handshakeMessage", type, raw, parsed);
  });
  session.on("keylog", function(line) {
    self2.emit("keylog", line);
  });
  session.on("clienthello", function(raw, parsed) {
    self2.emit("clienthello", raw, parsed);
  });
  if (context.handshakeTimeout > 0) {
    context.handshakeTimer = setTimeout(function() {
      if (!context.secureEstablished) {
        self2.emit("error", new Error("Handshake timeout after " + context.handshakeTimeout + "ms"));
        self2.destroy();
      }
    }, context.handshakeTimeout);
  }
  if (context.certificateCallback && options.isServer) {
    session.on("hello", function() {
      let info = {
        servername: session.context.remote_sni,
        version: session.context.selected_version,
        ciphers: session.context.remote_supported_cipher_suites,
        sigalgs: session.context.remote_supported_signature_algorithms,
        groups: session.context.remote_supported_groups,
        alpns: session.context.remote_supported_alpns
      };
      context.certificateCallback(info, function(err, ctx) {
        if (!err && ctx) {
          session.set_context({
            local_cert_chain: ctx.certificateChain,
            cert_private_key: ctx.privateKey
          });
        }
      });
    });
  }
  session.on("keyUpdate", function(info) {
    if (info.direction === "send") {
      let d = deriveKeys(info.secret, session.getCipher());
      context.app_write_key = d.key;
      context.app_write_iv = d.iv;
      context.app_write_seq = 0;
    } else if (info.direction === "receive") {
      let d = deriveKeys(info.secret, session.getCipher());
      context.app_read_key = d.key;
      context.app_read_iv = d.iv;
      context.app_read_seq = 0;
    }
    self2.emit("keyUpdate", info.direction);
  });
  session.on("certificateRequest", function(msg) {
    self2.emit("certificateRequest", msg);
  });
  if (options.isServer) {
    session.on("psk", function(info, callback) {
      if (self2.listenerCount("psk") > 0) {
        self2.emit("psk", info, callback);
        return;
      }
      let state = decrypt_session_blob(info.identity, context.ticketKeys);
      if (state && state.v === 13 && state.psk && state.cipher) {
        callback({ psk: state.psk, cipher: state.cipher });
      } else {
        callback(null);
      }
    });
  }
  session.on("newSession", function(sessionId, sessionData, cb) {
    if (self2.listenerCount("newSession") > 0) {
      self2.emit("newSession", sessionId, sessionData, cb);
    } else {
      cb();
    }
  });
  session.on("resumeSession", function(sessionId, cb) {
    if (self2.listenerCount("resumeSession") > 0) {
      self2.emit("resumeSession", sessionId, cb);
    } else {
      cb(null, null);
    }
  });
  if (context.transport) {
    bindTransport();
  }
  function _awaitTransportDrain(callback) {
    const t = context.transport;
    if (!t) {
      process.nextTick(() => callback(new Error("No transport")));
      return;
    }
    const cleanup = () => {
      t.removeListener("drain", onDrain);
      t.removeListener("error", onError);
      t.removeListener("close", onClose);
    };
    const onDrain = () => {
      cleanup();
      callback();
    };
    const onError = (err) => {
      cleanup();
      callback(err);
    };
    const onClose = () => {
      cleanup();
      callback(new Error("Transport closed before drain"));
    };
    t.once("drain", onDrain);
    t.once("error", onError);
    t.once("close", onClose);
  }
  self2._write = function(chunk, encoding, callback) {
    if (context.destroyed) {
      callback(new Error("Socket destroyed"));
      return;
    }
    const buf = toBuf(chunk);
    if (!context.using_app_keys) {
      context.appWriteQueue.push(buf);
      process.nextTick(callback);
      return;
    }
    const transportOk = writeAppData(buf);
    if (transportOk !== false) {
      process.nextTick(callback);
    } else {
      _awaitTransportDrain(callback);
    }
  };
  self2._writev = function(chunks, callback) {
    if (context.destroyed) {
      callback(new Error("Socket destroyed"));
      return;
    }
    let combined;
    if (chunks.length === 1) {
      combined = toBuf(chunks[0].chunk);
    } else {
      let totalLen = 0;
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i].chunk;
        totalLen += Buffer.isBuffer(c) ? c.length : c.byteLength || Buffer.byteLength(c);
      }
      combined = Buffer.allocUnsafe(totalLen);
      let off = 0;
      for (let i = 0; i < chunks.length; i++) {
        const buf = toBuf(chunks[i].chunk);
        buf.copy(combined, off);
        off += buf.length;
      }
    }
    if (!context.using_app_keys) {
      context.appWriteQueue.push(combined);
      process.nextTick(callback);
      return;
    }
    const transportOk = writeAppData(combined);
    if (transportOk !== false) {
      process.nextTick(callback);
    } else {
      _awaitTransportDrain(callback);
    }
  };
  self2._read = function() {
  };
  self2.setSocket = function(duplex2) {
    if (!duplex2 || typeof duplex2.write !== "function") throw new Error("setSocket expects a Duplex-like stream");
    context.transport = duplex2;
    bindTransport();
    while (context.pendingHandshake.length > 0) {
      let msg = context.pendingHandshake.shift();
      writeRecord2(msg.type, Buffer.from(msg.data));
    }
  };
  self2.end = /* @__PURE__ */ (function(originalEnd) {
    return function(data, encoding, callback) {
      if (context.destroyed) return this;
      session.close();
      try {
        context.transport && context.transport.end && context.transport.end();
      } catch (e) {
      }
      return originalEnd.call(this, data, encoding, callback);
    };
  })(self2.end);
  self2.destroy = /* @__PURE__ */ (function(originalDestroy) {
    return function(err) {
      if (context.destroyed) return this;
      context.destroyed = true;
      try {
        context.transport && context.transport.destroy && context.transport.destroy();
      } catch (e) {
      }
      return originalDestroy.call(this, err);
    };
  })(self2.destroy);
  self2.getSession = function() {
    return _lastSessionBuffer;
  };
  self2._getTLSSession = function() {
    return session;
  };
  Object.defineProperty(self2, "isResumed", { get: function() {
    return session.isResumed;
  } });
  self2.getProtocol = function() {
    let v = session.getVersion();
    if (v === 772) return "TLSv1.3";
    if (v === 771) return "TLSv1.2";
    if (v === 770) return "TLSv1.1";
    if (v === 769) return "TLSv1";
    return null;
  };
  self2.getCipher = function() {
    let code = session.getCipher();
    if (code == null) return null;
    let info = TLS_CIPHER_SUITES[code];
    if (!info) return { name: "0x" + code.toString(16), standardName: "unknown", version: self2.getProtocol() };
    return {
      name: info.name || info.cipher || "0x" + code.toString(16),
      standardName: info.standardName || info.cipher || "unknown",
      version: self2.getProtocol()
    };
  };
  Object.defineProperty(self2, "alpnProtocol", {
    get: function() {
      return session.getALPN() || false;
    },
    enumerable: true
  });
  Object.defineProperty(self2, "servername", {
    get: function() {
      let name = null;
      try {
        name = session.context && session.context.remote_sni;
      } catch {
      }
      if (!name && options && options.servername) name = options.servername;
      return name || false;
    },
    enumerable: true
  });
  Object.defineProperty(self2, "authorized", {
    get: function() {
      return session.authorized;
    },
    enumerable: true
  });
  Object.defineProperty(self2, "authorizationError", {
    get: function() {
      return session.authorizationError;
    },
    enumerable: true
  });
  Object.defineProperty(self2, "encrypted", {
    get: function() {
      return context.secureEstablished;
    },
    enumerable: true
  });
  self2.getPeerCertificate = function() {
    let chain = session.getPeerCertificate();
    if (!chain || chain.length === 0) return null;
    try {
      let certDer = chain[0].cert;
      let x509 = new browser_crypto_shim_default.X509Certificate(certDer);
      return {
        subject: x509.subject,
        issuer: x509.issuer,
        subjectaltname: x509.subjectAltName,
        valid_from: x509.validFrom,
        valid_to: x509.validTo,
        fingerprint: x509.fingerprint,
        fingerprint256: x509.fingerprint256,
        serialNumber: x509.serialNumber,
        raw: certDer
      };
    } catch (e) {
      return { raw: chain[0].cert };
    }
  };
  self2.getPeerX509Certificate = function() {
    let chain = session.getPeerCertificate();
    if (!chain || chain.length === 0) return void 0;
    try {
      return new browser_crypto_shim_default.X509Certificate(chain[0].cert);
    } catch (e) {
      return void 0;
    }
  };
  self2.getX509Certificate = function() {
    let sctx = session.context;
    let localChain = sctx && sctx.local_cert_chain;
    if (!localChain || localChain.length === 0) return void 0;
    try {
      let der = localChain[0].cert || localChain[0];
      return new browser_crypto_shim_default.X509Certificate(der);
    } catch (e) {
      return void 0;
    }
  };
  self2.getCertificate = function() {
    let sctx = session.context;
    let localChain = sctx && sctx.local_cert_chain;
    if (!localChain || localChain.length === 0) return {};
    try {
      let der = localChain[0].cert || localChain[0];
      let x509 = new browser_crypto_shim_default.X509Certificate(der);
      return {
        subject: x509.subject,
        issuer: x509.issuer,
        subjectaltname: x509.subjectAltName,
        valid_from: x509.validFrom,
        valid_to: x509.validTo,
        fingerprint: x509.fingerprint,
        fingerprint256: x509.fingerprint256,
        serialNumber: x509.serialNumber,
        raw: der
      };
    } catch (e) {
      return {};
    }
  };
  self2.getTLSTicket = function() {
    let sctx = session.context;
    let t = sctx && sctx.tls12_received_ticket;
    if (!t || t.length === 0) return void 0;
    return Buffer.isBuffer(t) ? t : Buffer.from(t);
  };
  self2.getSharedSigalgs = function() {
    let sctx = session.context;
    let local = sctx && sctx.local_supported_signature_algorithms || [];
    let remote = sctx && sctx.remote_supported_signature_algorithms || [];
    if (!local.length || !remote.length) return [];
    let set = new Set(remote);
    let out = [];
    for (let code of local) {
      if (set.has(code)) out.push(sigalgCodeToName(code));
    }
    return out;
  };
  self2.setMaxSendFragment = function(size) {
    size = Number(size);
    if (!Number.isInteger(size) || size < 512 || size > 16384) {
      throw new RangeError("setMaxSendFragment: size must be an integer in [512, 16384]");
    }
    self2._maxSendFragment = size;
    return true;
  };
  self2.enableTrace = function() {
  };
  Object.defineProperty(self2, "remoteAddress", {
    get: function() {
      return context.transport ? context.transport.remoteAddress : void 0;
    },
    enumerable: true
  });
  Object.defineProperty(self2, "remotePort", {
    get: function() {
      return context.transport ? context.transport.remotePort : void 0;
    },
    enumerable: true
  });
  Object.defineProperty(self2, "remoteFamily", {
    get: function() {
      return context.transport ? context.transport.remoteFamily : void 0;
    },
    enumerable: true
  });
  Object.defineProperty(self2, "localAddress", {
    get: function() {
      return context.transport ? context.transport.localAddress : void 0;
    },
    enumerable: true
  });
  Object.defineProperty(self2, "localPort", {
    get: function() {
      return context.transport ? context.transport.localPort : void 0;
    },
    enumerable: true
  });
  Object.defineProperty(self2, "localFamily", {
    get: function() {
      return context.transport ? context.transport.localFamily : void 0;
    },
    enumerable: true
  });
  Object.defineProperty(self2, "bytesRead", {
    get: function() {
      return context.transport ? context.transport.bytesRead : 0;
    },
    enumerable: true
  });
  Object.defineProperty(self2, "bytesWritten", {
    get: function() {
      return context.transport ? context.transport.bytesWritten : 0;
    },
    enumerable: true
  });
  self2.setNoDelay = function(noDelay) {
    if (context.transport && typeof context.transport.setNoDelay === "function") {
      context.transport.setNoDelay(noDelay);
    }
    return self2;
  };
  self2.setKeepAlive = function(enable, initialDelay) {
    if (context.transport && typeof context.transport.setKeepAlive === "function") {
      context.transport.setKeepAlive(enable, initialDelay);
    }
    return self2;
  };
  self2.setTimeout = function(msecs, callback) {
    if (context.transport && typeof context.transport.setTimeout === "function") {
      context.transport.setTimeout(msecs, callback);
    }
    return self2;
  };
  self2.ref = function() {
    if (context.transport && typeof context.transport.ref === "function") {
      context.transport.ref();
    }
    return self2;
  };
  self2.unref = function() {
    if (context.transport && typeof context.transport.unref === "function") {
      context.transport.unref();
    }
    return self2;
  };
  Object.defineProperty(self2, "handshakeDuration", {
    get: function() {
      return session.handshakeDuration;
    },
    enumerable: true
  });
  self2.getJA3 = function() {
    return session.getJA3 ? session.getJA3() : null;
  };
  self2.getSharedSecret = function() {
    return session.getSharedSecret ? session.getSharedSecret() : null;
  };
  self2.getNegotiationResult = function() {
    return session.getNegotiationResult ? session.getNegotiationResult() : null;
  };
  self2.exportKeyingMaterial = function(length2, label, context_value) {
    return session.exportKeyingMaterial ? session.exportKeyingMaterial(length2, label, context_value) : null;
  };
  self2.getRemoteExtensions = function() {
    return session.getRemoteExtensions ? session.getRemoteExtensions() : [];
  };
  self2.getRemoteExtension = function(type) {
    return session.getRemoteExtension ? session.getRemoteExtension(type) : null;
  };
  self2.rekeySend = function() {
    if (session.requestKeyUpdate) session.requestKeyUpdate(false);
  };
  self2.rekeyBoth = function() {
    if (session.requestKeyUpdate) session.requestKeyUpdate(true);
  };
  return self2;
}
Object.setPrototypeOf(TLSSocket.prototype, Duplex.prototype);
Object.setPrototypeOf(TLSSocket, Duplex);
var tls_socket_default = TLSSocket;

// node_modules/quico/node_modules/lemon-tls/src/compat.js
var DEFAULT_MIN_VERSION = "TLSv1.2";
var DEFAULT_MAX_VERSION = "TLSv1.3";
var DEFAULT_CIPHERS = [
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "TLS_AES_128_GCM_SHA256",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES128-GCM-SHA256"
].join(":");
function Server(options, connectionListener) {
  if (!(this instanceof Server)) return new Server(options, connectionListener);
  EventEmitter.call(this);
  let self2 = this;
  options = options || {};
  self2._ticketKeys = options.ticketKeys ? Buffer.from(options.ticketKeys) : browser_crypto_shim_default.randomBytes(48);
  let sessionTimeoutSec = typeof options.sessionTimeout === "number" && options.sessionTimeout > 0 ? options.sessionTimeout >>> 0 : 300;
  let sessionIdContextHex = "";
  if (options.sessionIdContext != null) {
    let sidCtxBuf = Buffer.isBuffer(options.sessionIdContext) ? options.sessionIdContext : Buffer.from(String(options.sessionIdContext));
    sessionIdContextHex = sidCtxBuf.toString("hex");
  }
  let defaultCtx = null;
  if (options.key && options.cert) {
    defaultCtx = secure_context_default({ key: options.key, cert: options.cert });
  }
  let inMemoryStore = {};
  function storeKey(id) {
    return sessionIdContextHex + ":" + toHex(id);
  }
  function buildSocketOpts() {
    let socketOpts = {
      isServer: true,
      ticketKeys: self2._ticketKeys,
      ticketLifetime: options.ticketLifetime,
      ALPNProtocols: options.ALPNProtocols,
      minVersion: options.minVersion || DEFAULT_MIN_VERSION,
      maxVersion: options.maxVersion || DEFAULT_MAX_VERSION,
      signatureAlgorithms: options.signatureAlgorithms,
      groups: options.groups,
      prioritizeChaCha: options.prioritizeChaCha,
      maxRecordSize: options.maxRecordSize,
      sessionTickets: options.sessionTickets,
      requestCert: options.requestCert,
      // Client-authentication policy. These were missing, so a server's
      // rejectUnauthorized/ca never reached TLSSession and it fell back to the
      // session default (rejectUnauthorized: true). The effect was invisible
      // until client auth was actually exercised: `requestCert: true` WITHOUT
      // `rejectUnauthorized` is the standard "ask for a certificate but accept
      // clients that have none" configuration, and it rejected them instead.
      // requestCert was forwarded and its two companions were not, which is
      // exactly the kind of half-wired option that looks correct at a glance.
      rejectUnauthorized: options.rejectUnauthorized,
      ca: options.ca,
      maxHandshakeSize: options.maxHandshakeSize,
      allowedCipherSuites: options.allowedCipherSuites,
      handshakeTimeout: options.handshakeTimeout
    };
    if (options.SNICallback) {
      socketOpts.SNICallback = options.SNICallback;
    } else if (defaultCtx) {
      socketOpts.SNICallback = function(servername, cb) {
        cb(null, defaultCtx);
      };
    }
    return socketOpts;
  }
  self2._tcpServer = empty_default.createServer(function(tcp) {
    let socket;
    try {
      socket = new tls_socket_default(tcp, buildSocketOpts());
    } catch (err) {
      self2.emit("tlsClientError", err, null);
      try {
        tcp.destroy();
      } catch (e) {
      }
      return;
    }
    addCompatMethods(socket);
    socket.on("newSession", function(id, data, cb) {
      if (self2.listenerCount("newSession") > 0) {
        self2.emit("newSession", Buffer.from(id), Buffer.from(data), cb);
      } else {
        inMemoryStore[storeKey(id)] = {
          data: Buffer.from(data),
          expiresAt: Date.now() + sessionTimeoutSec * 1e3
        };
        cb();
      }
    });
    socket.on("resumeSession", function(id, cb) {
      if (self2.listenerCount("resumeSession") > 0) {
        self2.emit("resumeSession", Buffer.from(id), cb);
      } else {
        let key = storeKey(id);
        let entry = inMemoryStore[key];
        if (!entry) return cb(null, null);
        if (entry.expiresAt < Date.now()) {
          delete inMemoryStore[key];
          return cb(null, null);
        }
        cb(null, entry.data);
      }
    });
    socket.on("secureConnect", function() {
      if (connectionListener) connectionListener(socket);
      self2.emit("secureConnection", socket);
    });
    socket.on("keylog", function(line) {
      self2.emit("keylog", line, socket);
    });
    socket.on("error", function(err) {
      if (!socket.secureEstablished) {
        self2.emit("tlsClientError", err, socket);
      }
    });
  });
  self2.listen = function() {
    return self2._tcpServer.listen.apply(self2._tcpServer, arguments);
  };
  self2.close = function(cb) {
    return self2._tcpServer.close(cb);
  };
  self2.address = function() {
    return self2._tcpServer.address();
  };
  self2.getConnections = function(cb) {
    return self2._tcpServer.getConnections(cb);
  };
  self2.getTicketKeys = function() {
    return Buffer.from(self2._ticketKeys);
  };
  self2.setTicketKeys = function(keys) {
    if (!Buffer.isBuffer(keys) && !(keys instanceof Uint8Array)) {
      throw new TypeError("setTicketKeys requires a Buffer/Uint8Array");
    }
    if (keys.length !== 48) {
      throw new RangeError("ticketKeys must be exactly 48 bytes");
    }
    self2._ticketKeys = Buffer.from(keys);
  };
  self2.setSecureContext = function(opts) {
    if (opts && opts.key && opts.cert) {
      defaultCtx = secure_context_default({ key: opts.key, cert: opts.cert });
    }
  };
  return self2;
}
Object.setPrototypeOf(Server.prototype, EventEmitter.prototype);
Object.setPrototypeOf(Server, EventEmitter);
function toHex(buf) {
  if (!buf) return "";
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString("hex");
}
function addCompatMethods(socket) {
  let session = socket._getTLSSession();
  function def(name, fn) {
    if (typeof socket[name] !== "function") socket[name] = fn;
  }
  def("isSessionReused", function() {
    return socket.isResumed;
  });
  def("getFinished", function() {
    return session.getFinished ? session.getFinished() : null;
  });
  def("getPeerFinished", function() {
    return session.getPeerFinished ? session.getPeerFinished() : null;
  });
  def("exportKeyingMaterial", function(length2, label, context) {
    return session.exportKeyingMaterial ? session.exportKeyingMaterial(length2, label, context) : null;
  });
  def("getEphemeralKeyInfo", function() {
    let group = session.context.selected_group;
    if (group === 29) return { type: "X25519", size: 253 };
    if (group === 23) return { type: "ECDH", name: "prime256v1", size: 256 };
    if (group === 24) return { type: "ECDH", name: "secp384r1", size: 384 };
    return {};
  });
  def("setServername", function(name) {
    session.set_context({ local_sni: name });
  });
  def("disableRenegotiation", function() {
  });
  def("address", function() {
    try {
      return session.context && session.context.transport ? session.context.transport.address() : {};
    } catch (e) {
      return {};
    }
  });
}

// node_modules/quico/node_modules/lemon-tls/src/dtls_session.js
var LEMON_DEBUG2 = typeof process !== "undefined" && process.env && (process.env.LEMON_DEBUG === "1" || process.env.WEBRTC_DEBUG === "1");

// node_modules/quico/node_modules/lemon-tls/index.js
var crypto = {
  TLS_CIPHER_SUITES,
  getHashFn,
  getHashLen: getHashLen2,
  hkdf_extract,
  hkdf_expand,
  hkdf_expand_label,
  hmac: hmac2,
  // Keying-material exporters (RFC 5705 / RFC 8446 §7.5) — standalone
  // primitives for consumers that hold raw secrets (offline analysis,
  // custom transports). Live sessions should prefer
  // session.exportKeyingMaterial(), which picks the right one.
  tls12_prf,
  tls12_exporter,
  tls13_exporter
};

// node_modules/quico/src/crypto.js
var hkdf_extract2 = crypto.hkdf_extract;
var hkdf_expand_label2 = crypto.hkdf_expand_label;
var getHashFn2 = crypto.getHashFn;
var getHashLen3 = crypto.getHashLen;
var TLS_CIPHER_SUITES2 = crypto.TLS_CIPHER_SUITES;
var INITIAL_SALTS = {
  1: new Uint8Array([
    56,
    118,
    44,
    247,
    245,
    89,
    52,
    179,
    77,
    23,
    154,
    230,
    164,
    200,
    12,
    173,
    204,
    187,
    127,
    10
  ]),
  4278190109: new Uint8Array([
    175,
    191,
    236,
    40,
    153,
    147,
    210,
    76,
    158,
    151,
    134,
    241,
    156,
    97,
    17,
    224,
    67,
    144,
    168,
    153
  ]),
  4278190112: new Uint8Array([
    127,
    188,
    219,
    14,
    124,
    102,
    187,
    119,
    123,
    227,
    14,
    189,
    95,
    165,
    21,
    135,
    61,
    141,
    110,
    103
  ])
};
function quic_derive_init_secrets(client_dcid, version, direction) {
  var hashName = "sha256";
  var hashFn = getHashFn2(hashName);
  var salt = INITIAL_SALTS[version];
  if (!salt) throw new Error("Unsupported QUIC version: 0x" + version.toString(16));
  var label = direction === "read" ? "client in" : "server in";
  var initial_secret = hkdf_extract2(hashName, salt, client_dcid);
  var side_secret = hkdf_expand_label2(
    hashName,
    initial_secret,
    label,
    new Uint8Array(0),
    32
  );
  return {
    key: hkdf_expand_label2(hashName, side_secret, "quic key", new Uint8Array(0), 16),
    iv: hkdf_expand_label2(hashName, side_secret, "quic iv", new Uint8Array(0), 12),
    hp: hkdf_expand_label2(hashName, side_secret, "quic hp", new Uint8Array(0), 16)
  };
}
function quic_derive_from_tls_secrets(traffic_secret, hashName, cipher) {
  if (!traffic_secret) return null;
  var keyLen = 16;
  if (cipher && TLS_CIPHER_SUITES2[cipher]) {
    keyLen = TLS_CIPHER_SUITES2[cipher].keylen;
  } else if (hashName === "sha384") {
    keyLen = 32;
  }
  return {
    key: hkdf_expand_label2(hashName, traffic_secret, "quic key", new Uint8Array(0), keyLen),
    iv: hkdf_expand_label2(hashName, traffic_secret, "quic iv", new Uint8Array(0), 12),
    hp: hkdf_expand_label2(hashName, traffic_secret, "quic hp", new Uint8Array(0), keyLen)
  };
}
function quic_derive_key_update(current_secret, hashName, cipher) {
  var hashLen = getHashLen3(hashName);
  var keyLen = 16;
  if (cipher && TLS_CIPHER_SUITES2[cipher]) {
    keyLen = TLS_CIPHER_SUITES2[cipher].keylen;
  } else if (hashName === "sha384") {
    keyLen = 32;
  }
  var next_secret = hkdf_expand_label2(hashName, current_secret, "quic ku", new Uint8Array(0), hashLen);
  return {
    secret: next_secret,
    key: hkdf_expand_label2(hashName, next_secret, "quic key", new Uint8Array(0), keyLen),
    iv: hkdf_expand_label2(hashName, next_secret, "quic iv", new Uint8Array(0), 12),
    hp: hkdf_expand_label2(hashName, next_secret, "quic hp", new Uint8Array(0), keyLen)
  };
}
function compute_nonce(iv, packetNumber) {
  var nonce = new Uint8Array(iv);
  var n = packetNumber;
  for (var i = 11; n > 0 && i >= 0; i--) {
    nonce[i] ^= n & 255;
    n = Math.floor(n / 256);
  }
  return nonce;
}
function aead_algo(keyLen) {
  if (keyLen === 16) return "aes-128-gcm";
  if (keyLen === 32) return "aes-256-gcm";
  throw new Error("Unsupported key length: " + keyLen);
}
function aead_encrypt(key, iv, packetNumber, plaintext, aad) {
  try {
    var nonce = compute_nonce(iv, packetNumber);
    var cipher = browser_crypto_shim_default.createCipheriv(aead_algo(key.length), key, nonce);
    cipher.setAAD(aad);
    var encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    var tag = cipher.getAuthTag();
    var result = new Uint8Array(encrypted.length + tag.length);
    result.set(encrypted, 0);
    result.set(tag, encrypted.length);
    return result;
  } catch (e) {
    return null;
  }
}
function aead_decrypt(key, nonce, ciphertext, tag, aad) {
  try {
    var decipher = browser_crypto_shim_default.createDecipheriv(aead_algo(key.length), key, nonce);
    decipher.setAuthTag(tag);
    decipher.setAAD(aad);
    var decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return new Uint8Array(decrypted);
  } catch (e) {
    return null;
  }
}
function aes_ecb_encrypt(key, plaintext) {
  var algo = key.length === 32 ? "aes-256-ecb" : "aes-128-ecb";
  var cipher = browser_crypto_shim_default.createCipheriv(algo, key, null);
  cipher.setAutoPadding(false);
  return new Uint8Array(Buffer.concat([cipher.update(plaintext), cipher.final()]));
}
function apply_header_protection(packet, pnOffset, hpKey, pnLength) {
  var sample = packet.slice(pnOffset + 4, pnOffset + 4 + 16);
  if (sample.length < 16) throw new Error("Not enough bytes for HP sample");
  var mask = aes_ecb_encrypt(hpKey, sample);
  var isLong = (packet[0] & 128) !== 0;
  packet[0] ^= mask[0] & (isLong ? 15 : 31);
  for (var i = 0; i < pnLength; i++) {
    packet[pnOffset + i] ^= mask[1 + i];
  }
  return packet;
}
function remove_header_protection(array, pnOffset, hpKey, isShort) {
  var sample = array.slice(pnOffset + 4, pnOffset + 4 + 16);
  var mask = aes_ecb_encrypt(hpKey, sample);
  if (isShort) {
    array[0] ^= mask[0] & 31;
  } else {
    array[0] ^= mask[0] & 15;
  }
  var pnLength = (array[0] & 3) + 1;
  for (var i = 0; i < pnLength; i++) {
    array[pnOffset + i] ^= mask[1 + i];
  }
  return pnLength;
}
function expandPacketNumber(truncated, pnLen, largestReceived) {
  var pnWin = Math.pow(2, pnLen * 8);
  var pnHalf = pnWin / 2;
  var expected = largestReceived + 1;
  return truncated + pnWin * Math.floor((expected - truncated + pnHalf) / pnWin);
}
function decode_packet_number(array, offset, pnLength) {
  var value = 0;
  for (var i = 0; i < pnLength; i++) {
    value = value * 256 + array[offset + i];
  }
  return value;
}
function encode_packet_number(packetNumber) {
  var pnLength;
  if (packetNumber <= 255) pnLength = 1;
  else if (packetNumber <= 65535) pnLength = 2;
  else if (packetNumber <= 16777215) pnLength = 3;
  else pnLength = 4;
  var buf = new Uint8Array(4);
  buf[0] = packetNumber >>> 24 & 255;
  buf[1] = packetNumber >>> 16 & 255;
  buf[2] = packetNumber >>> 8 & 255;
  buf[3] = packetNumber & 255;
  return { bytes: buf.slice(4 - pnLength), length: pnLength };
}
function build_quic_header(packetType, dcid, scid, token, lengthField, pnLen, keyPhase) {
  var hdr = [];
  var firstByte;
  if (packetType === "1rtt") {
    firstByte = 64 | pnLen - 1 & 3;
    if (keyPhase) firstByte |= 4;
    hdr.push(Uint8Array.of(firstByte));
    hdr.push(dcid);
    var header = concatUint8Arrays(hdr);
    return { header, pnOffset: header.length };
  }
  if (packetType === "initial") {
    firstByte = 192 | pnLen - 1 & 3;
  } else if (packetType === "handshake") {
    firstByte = 224 | pnLen - 1 & 3;
  } else if (packetType === "0rtt") {
    firstByte = 208 | pnLen - 1 & 3;
  } else {
    throw new Error("Unsupported packet type: " + packetType);
  }
  hdr.push(Uint8Array.of(firstByte));
  hdr.push(new Uint8Array([0, 0, 0, 1]));
  hdr.push(writeVarInt(dcid.length), dcid);
  hdr.push(writeVarInt(scid.length), scid);
  if (packetType === "initial") {
    if (!token) token = new Uint8Array(0);
    hdr.push(writeVarInt(token.length), token);
  }
  hdr.push(lengthField);
  var header = concatUint8Arrays(hdr);
  return { header, pnOffset: header.length };
}
function encrypt_quic_packet(packetType, encodedFrames, writeKey, writeIv, writeHp, packetNumber, dcid, scid, token, keyPhase) {
  var pn = encode_packet_number(packetNumber);
  var pnLength = pn.length;
  var pnBytes = pn.bytes;
  var payloadLen = encodedFrames.length + pnLength + 16;
  var lengthField = writeVarInt(payloadLen);
  var hdrInfo = build_quic_header(packetType, dcid, scid, token, lengthField, pnLength, keyPhase);
  var header = hdrInfo.header;
  var pnOffset = hdrInfo.pnOffset;
  var minTotal = pnOffset + pnLength + 20;
  var fullLen = header.length + pnLength + encodedFrames.length + 16;
  if (fullLen < minTotal) {
    var extra = minTotal - fullLen;
    var padded = new Uint8Array(encodedFrames.length + extra);
    padded.set(encodedFrames, 0);
    encodedFrames = padded;
    payloadLen = encodedFrames.length + pnLength + 16;
    lengthField = writeVarInt(payloadLen);
    hdrInfo = build_quic_header(packetType, dcid, scid, token, lengthField, pnLength, keyPhase);
    header = hdrInfo.header;
    pnOffset = hdrInfo.pnOffset;
  }
  var aad = concatUint8Arrays([header, pnBytes]);
  var ciphertext = aead_encrypt(writeKey, writeIv, packetNumber, encodedFrames, aad);
  if (ciphertext === null) return null;
  var fullPacket = concatUint8Arrays([header, pnBytes, ciphertext]);
  return apply_header_protection(fullPacket, pnOffset, writeHp, pnLength);
}
function decrypt_quic_packet(array, readKey, readIv, readHp, ownCid, largestPn) {
  if (!(array instanceof Uint8Array)) throw new Error("Invalid input");
  array = array.slice();
  var firstByte = array[0];
  var isShort = (firstByte & 128) === 0;
  var pnOffset, pnLength, aad, ciphertext, tag, packetNumber, nonce, keyPhase = false;
  if (!isShort) {
    var offset = 6;
    var dcidLen = array[5];
    offset += dcidLen;
    var scidLen = array[offset++];
    offset += scidLen;
    var typeBits = (firstByte & 48) >> 4;
    if (typeBits === 0) {
      var tokenLen = readVarInt(array, offset);
      offset += tokenLen.byteLength + tokenLen.value;
    }
    var len = readVarInt(array, offset);
    offset += len.byteLength;
    pnOffset = offset;
    pnLength = remove_header_protection(array, pnOffset, readHp, false);
    if (pnLength === null) return null;
    packetNumber = expandPacketNumber(
      decode_packet_number(array, pnOffset, pnLength),
      pnLength,
      largestPn
    );
    nonce = compute_nonce(readIv, packetNumber);
    var payloadStart = pnOffset + pnLength;
    var payloadLength = len.value - pnLength;
    var payloadEnd = payloadStart + payloadLength;
    if (payloadEnd > array.length) return null;
    var payload = array.slice(payloadStart, payloadEnd);
    if (payload.length < 16) return null;
    ciphertext = payload.slice(0, payload.length - 16);
    tag = payload.slice(payload.length - 16);
    aad = array.slice(0, pnOffset + pnLength);
  } else {
    var dcidLen = ownCid.length;
    pnOffset = 1 + dcidLen;
    pnLength = remove_header_protection(array, pnOffset, readHp, true);
    if (pnLength === null) return null;
    keyPhase = Boolean((array[0] & 4) >>> 2);
    packetNumber = expandPacketNumber(
      decode_packet_number(array, pnOffset, pnLength),
      pnLength,
      largestPn
    );
    nonce = compute_nonce(readIv, packetNumber);
    var payload = array.slice(pnOffset + pnLength);
    if (payload.length < 16) return null;
    ciphertext = payload.slice(0, payload.length - 16);
    tag = payload.slice(payload.length - 16);
    aad = array.slice(0, pnOffset + pnLength);
  }
  var plaintext = aead_decrypt(readKey, nonce, ciphertext, tag, aad);
  return {
    packet_number: packetNumber,
    key_phase: keyPhase,
    plaintext
  };
}
function extract_tls_messages_from_chunks(chunks, from_offset) {
  var offset = from_offset;
  var buffers = [];
  while (chunks[offset]) {
    buffers.push(chunks[offset]);
    offset += chunks[offset].length;
  }
  if (buffers.length === 0) return false;
  var combined = concatUint8Arrays(buffers);
  var tls_messages = [];
  var i = 0;
  while (i + 4 <= combined.length) {
    var msgType = combined[i];
    var length2 = combined[i + 1] << 16 | combined[i + 2] << 8 | combined[i + 3];
    if (i + 4 + length2 > combined.length) break;
    tls_messages.push(combined.slice(i, i + 4 + length2));
    i += 4 + length2;
  }
  if (i > 0) {
    var cleanupOffset = from_offset;
    while (cleanupOffset < offset) {
      var c = chunks[cleanupOffset];
      if (!c) break;
      var nextOffset = cleanupOffset + c.length;
      delete chunks[cleanupOffset];
      cleanupOffset = nextOffset;
    }
    var newFromOffset = from_offset + i;
    if (i < combined.length) {
      chunks[newFromOffset] = combined.slice(i);
    }
    from_offset = newFromOffset;
  }
  return { tls_messages, new_from_offset: from_offset };
}

// node_modules/quico/src/transport.js
function parse_quic_packet(array, offset0) {
  if (!(array instanceof Uint8Array)) return null;
  if (offset0 === void 0) offset0 = 0;
  if (offset0 >= array.length) return null;
  var firstByte = array[offset0];
  var isLong = (firstByte & 128) !== 0;
  if (isLong) {
    if (offset0 + 6 > array.length) return null;
    var version = (array[offset0 + 1] << 24 | array[offset0 + 2] << 16 | array[offset0 + 3] << 8 | array[offset0 + 4]) >>> 0;
    var dcidLen = array[offset0 + 5];
    var offset = offset0 + 6;
    if (offset + dcidLen + 1 > array.length) return null;
    var dcid = array.slice(offset, offset + dcidLen);
    offset += dcidLen;
    var scidLen = array[offset++];
    if (offset + scidLen > array.length) return null;
    var scid = array.slice(offset, offset + scidLen);
    offset += scidLen;
    if (version === 0) {
      var supportedVersions = [];
      while (offset + 4 <= array.length) {
        supportedVersions.push(
          array[offset] << 24 | array[offset + 1] << 16 | array[offset + 2] << 8 | array[offset + 3]
        );
        offset += 4;
      }
      return {
        form: "long",
        type: "version_negotiation",
        version,
        dcid,
        scid,
        supportedVersions,
        totalLength: offset - offset0
      };
    }
    var typeBits = (firstByte & 48) >> 4;
    var typeMap = ["initial", "0rtt", "handshake", "retry"];
    var packetType = typeMap[typeBits] || "unknown";
    if (packetType === "retry") {
      return {
        form: "long",
        type: "retry",
        version,
        dcid,
        scid,
        totalLength: array.length - offset0
      };
    }
    var token = null;
    if (packetType === "initial") {
      try {
        var tokenLen = readVarInt(array, offset);
        offset += tokenLen.byteLength;
        if (offset + tokenLen.value > array.length) return null;
        token = array.slice(offset, offset + tokenLen.value);
        offset += tokenLen.value;
      } catch (e) {
        return null;
      }
    }
    try {
      var lengthInfo = readVarInt(array, offset);
      offset += lengthInfo.byteLength;
      var totalLength = offset - offset0 + lengthInfo.value;
      if (offset0 + totalLength > array.length) return null;
      return {
        form: "long",
        type: packetType,
        version,
        dcid,
        scid,
        token,
        totalLength
      };
    } catch (e) {
      return null;
    }
  } else {
    if ((firstByte & 64) === 0) return null;
    return {
      form: "short",
      type: "1rtt",
      totalLength: array.length - offset0
    };
  }
}
function parse_quic_datagram(array) {
  var packets = [];
  var offset = 0;
  while (offset < array.length) {
    var pkt = parse_quic_packet(array, offset);
    if (!pkt || !pkt.totalLength) break;
    var start = offset;
    var end = offset + pkt.totalLength;
    pkt.raw = start === 0 && end === array.length ? array : array.slice(start, end);
    if (packets.length > 0) {
      if (DEBUG) console.log("[quic] coalesced pkt #" + packets.length + " type=" + pkt.type + " offset=" + start + " len=" + pkt.totalLength + " firstByte=0x" + array[start].toString(16).padStart(2, "0"));
    }
    packets.push(pkt);
    offset = end;
  }
  return packets;
}
function encode_quic_frames(frames) {
  var parts = [];
  for (var i = 0; i < frames.length; i++) {
    var frame = frames[i];
    if (frame.type === "padding") {
      parts.push(new Uint8Array(frame.length));
    } else if (frame.type === "ping") {
      parts.push(new Uint8Array([1]));
    } else if (frame.type === "ack") {
      var hasECN = frame.ecn !== null && frame.ecn !== void 0;
      var typeByte = hasECN ? 3 : 2;
      var temp = [
        new Uint8Array([typeByte]),
        writeVarInt(frame.largest),
        writeVarInt(frame.delay),
        writeVarInt(frame.ranges.length),
        writeVarInt(frame.firstRange != null ? frame.firstRange : 0)
      ];
      for (var j = 0; j < frame.ranges.length; j++) {
        temp.push(writeVarInt(frame.ranges[j].gap));
        temp.push(writeVarInt(frame.ranges[j].length));
      }
      if (hasECN) {
        temp.push(writeVarInt(frame.ecn.ect0));
        temp.push(writeVarInt(frame.ecn.ect1));
        temp.push(writeVarInt(frame.ecn.ce));
      }
      parts.push(concatUint8Arrays(temp));
    } else if (frame.type === "crypto") {
      parts.push(concatUint8Arrays([
        new Uint8Array([6]),
        writeVarInt(frame.offset),
        writeVarInt(frame.data.length),
        frame.data
      ]));
    } else if (frame.type === "stream") {
      var typeByte = 8;
      var hasOffset = frame.offset != null && frame.offset > 0;
      var hasFin = !!frame.fin;
      var dataLen = frame.data && frame.data.length ? frame.data.length : 0;
      if (hasOffset) typeByte |= 4;
      typeByte |= 2;
      if (hasFin) typeByte |= 1;
      parts.push(concatUint8Arrays([
        new Uint8Array([typeByte]),
        writeVarInt(frame.id),
        hasOffset ? writeVarInt(frame.offset) : new Uint8Array(0),
        writeVarInt(dataLen),
        frame.data || new Uint8Array(0)
      ]));
    } else if (frame.type === "new_token") {
      parts.push(concatUint8Arrays([
        new Uint8Array([7]),
        writeVarInt(frame.token.length),
        frame.token
      ]));
    } else if (frame.type === "max_data") {
      parts.push(concatUint8Arrays([
        new Uint8Array([16]),
        writeVarInt(frame.max)
      ]));
    } else if (frame.type === "max_stream_data") {
      parts.push(concatUint8Arrays([
        new Uint8Array([17]),
        writeVarInt(frame.id),
        writeVarInt(frame.max)
      ]));
    } else if (frame.type === "max_streams_bidi") {
      parts.push(concatUint8Arrays([
        new Uint8Array([18]),
        writeVarInt(frame.max)
      ]));
    } else if (frame.type === "max_streams_uni") {
      parts.push(concatUint8Arrays([
        new Uint8Array([19]),
        writeVarInt(frame.max)
      ]));
    } else if (frame.type === "connection_close") {
      var code = frame.application ? 29 : 28;
      var errorCode = writeVarInt(frame.error || 0);
      var frameType = frame.application ? new Uint8Array(0) : writeVarInt(frame.frameType || 0);
      var reason = new TextEncoder().encode(frame.reason || "");
      parts.push(concatUint8Arrays([
        new Uint8Array([code]),
        errorCode,
        frameType,
        writeVarInt(reason.length),
        reason
      ]));
    } else if (frame.type === "handshake_done") {
      parts.push(new Uint8Array([30]));
    } else if (frame.type === "new_connection_id") {
      parts.push(concatUint8Arrays([
        new Uint8Array([24]),
        writeVarInt(frame.seq),
        writeVarInt(frame.retire),
        new Uint8Array([frame.connId.length]),
        frame.connId,
        frame.token
      ]));
    } else if (frame.type === "retire_connection_id") {
      parts.push(concatUint8Arrays([
        new Uint8Array([25]),
        writeVarInt(frame.seq)
      ]));
    } else if (frame.type === "path_challenge" || frame.type === "path_response") {
      parts.push(concatUint8Arrays([
        new Uint8Array([frame.type === "path_challenge" ? 26 : 27]),
        frame.data
      ]));
    } else if (frame.type === "reset_stream") {
      parts.push(concatUint8Arrays([
        new Uint8Array([4]),
        writeVarInt(frame.id),
        writeVarInt(frame.error),
        writeVarInt(frame.finalSize)
      ]));
    } else if (frame.type === "stop_sending") {
      parts.push(concatUint8Arrays([
        new Uint8Array([5]),
        writeVarInt(frame.id),
        writeVarInt(frame.error)
      ]));
    } else if (frame.type === "data_blocked") {
      parts.push(concatUint8Arrays([
        new Uint8Array([20]),
        writeVarInt(frame.limit)
      ]));
    } else if (frame.type === "stream_data_blocked") {
      parts.push(concatUint8Arrays([
        new Uint8Array([21]),
        writeVarInt(frame.id),
        writeVarInt(frame.limit)
      ]));
    } else if (frame.type === "datagram") {
      parts.push(concatUint8Arrays([
        new Uint8Array([48]),
        frame.data
      ]));
    }
  }
  return parts.length === 1 ? parts[0] : concatUint8Arrays(parts);
}
function parse_quic_frames(buf) {
  var offset = 0;
  var frames = [];
  function safeReadVarInt() {
    if (offset >= buf.length) return null;
    var res = readVarInt(buf, offset);
    if (!res) return null;
    offset += res.byteLength;
    return res;
  }
  while (offset < buf.length) {
    var type = buf[offset++];
    if (type >= 128) {
      offset--;
      var t = safeReadVarInt();
      if (!t) break;
      type = t.value;
    }
    if (type === 0) {
    } else if (type === 1) {
      frames.push({ type: "ping" });
    } else if ((type & 254) === 2) {
      var hasECN = (type & 1) === 1;
      var largest = safeReadVarInt();
      if (!largest) break;
      var delay = safeReadVarInt();
      if (!delay) break;
      var rangeCount = safeReadVarInt();
      if (!rangeCount) break;
      var firstRange = safeReadVarInt();
      if (!firstRange) break;
      var ranges = [];
      for (var i = 0; i < rangeCount.value; i++) {
        var gap = safeReadVarInt();
        if (!gap) break;
        var len = safeReadVarInt();
        if (!len) break;
        ranges.push({ gap: gap.value, length: len.value });
      }
      var ecn = null;
      if (hasECN) {
        var ect0 = safeReadVarInt();
        if (!ect0) break;
        var ect1 = safeReadVarInt();
        if (!ect1) break;
        var ce = safeReadVarInt();
        if (!ce) break;
        ecn = { ect0: ect0.value, ect1: ect1.value, ce: ce.value };
      }
      frames.push({
        type: "ack",
        largest: largest.value,
        delay: delay.value,
        firstRange: firstRange.value,
        ranges,
        ecn
      });
    } else if (type === 4) {
      var id = safeReadVarInt();
      if (!id) break;
      var error = safeReadVarInt();
      if (!error) break;
      var finalSize = safeReadVarInt();
      if (!finalSize) break;
      frames.push({ type: "reset_stream", id: id.value, error: error.value, finalSize: finalSize.value });
    } else if (type === 5) {
      var id = safeReadVarInt();
      if (!id) break;
      var error = safeReadVarInt();
      if (!error) break;
      frames.push({ type: "stop_sending", id: id.value, error: error.value });
    } else if (type === 6) {
      var off = safeReadVarInt();
      if (!off) break;
      var len = safeReadVarInt();
      if (!len) break;
      if (offset + len.value > buf.length) break;
      var data = buf.slice(offset, offset + len.value);
      offset += len.value;
      frames.push({ type: "crypto", offset: off.value, data });
    } else if (type === 7) {
      var len = safeReadVarInt();
      if (!len) break;
      if (offset + len.value > buf.length) break;
      var token = buf.slice(offset, offset + len.value);
      offset += len.value;
      frames.push({ type: "new_token", token });
    } else if (type >= 8 && type <= 15) {
      var fin = !!(type & 1);
      var lenb = !!(type & 2);
      var offb = !!(type & 4);
      var stream_id = safeReadVarInt();
      if (!stream_id) break;
      var offset_val = offb ? safeReadVarInt() : { value: 0 };
      if (!offset_val) break;
      var length_val = lenb ? safeReadVarInt() : { value: buf.length - offset };
      if (!length_val) break;
      if (offset + length_val.value > buf.length) break;
      var data = buf.slice(offset, offset + length_val.value);
      offset += length_val.value;
      frames.push({
        type: "stream",
        id: stream_id.value,
        offset: offset_val.value,
        fin,
        data
      });
    } else if (type === 16) {
      var max = safeReadVarInt();
      if (!max) break;
      frames.push({ type: "max_data", max: max.value });
    } else if (type === 17) {
      var id = safeReadVarInt();
      if (!id) break;
      var max = safeReadVarInt();
      if (!max) break;
      frames.push({ type: "max_stream_data", id: id.value, max: max.value });
    } else if (type === 18 || type === 19) {
      var max = safeReadVarInt();
      if (!max) break;
      frames.push({ type: type === 18 ? "max_streams_bidi" : "max_streams_uni", max: max.value });
    } else if (type === 20) {
      var limit = safeReadVarInt();
      if (!limit) break;
      frames.push({ type: "data_blocked", limit: limit.value });
    } else if (type === 21) {
      var id = safeReadVarInt();
      if (!id) break;
      var limit = safeReadVarInt();
      if (!limit) break;
      frames.push({ type: "stream_data_blocked", id: id.value, limit: limit.value });
    } else if (type === 22 || type === 23) {
      var limit = safeReadVarInt();
      if (!limit) break;
      frames.push({ type: type === 22 ? "streams_blocked_bidi" : "streams_blocked_uni", limit: limit.value });
    } else if (type === 24) {
      var seq = safeReadVarInt();
      if (!seq) break;
      var retire = safeReadVarInt();
      if (!retire) break;
      if (offset >= buf.length) break;
      var cidLen = buf[offset++];
      if (offset + cidLen + 16 > buf.length) break;
      var connId = buf.slice(offset, offset + cidLen);
      offset += cidLen;
      var token = buf.slice(offset, offset + 16);
      offset += 16;
      frames.push({ type: "new_connection_id", seq: seq.value, retire: retire.value, connId, token });
    } else if (type === 25) {
      var seq = safeReadVarInt();
      if (!seq) break;
      frames.push({ type: "retire_connection_id", seq: seq.value });
    } else if (type === 26 || type === 27) {
      if (offset + 8 > buf.length) break;
      var data = buf.slice(offset, offset + 8);
      offset += 8;
      frames.push({ type: type === 26 ? "path_challenge" : "path_response", data });
    } else if (type === 28 || type === 29) {
      var error = safeReadVarInt();
      if (!error) break;
      var frameType = null;
      if (type === 28) {
        var ft = safeReadVarInt();
        if (!ft) break;
        frameType = ft.value;
      }
      var reasonLen = safeReadVarInt();
      if (!reasonLen) break;
      if (offset + reasonLen.value > buf.length) break;
      var reason = new TextDecoder().decode(buf.slice(offset, offset + reasonLen.value));
      offset += reasonLen.value;
      frames.push({
        type: "connection_close",
        application: type === 29,
        error: error.value,
        frameType,
        reason
      });
    } else if (type === 30) {
      frames.push({ type: "handshake_done" });
    } else if (type === 48 || type === 49) {
      var data;
      if (type === 49) {
        var len = safeReadVarInt();
        if (!len) break;
        var end = offset + len.value;
        if (end > buf.length) break;
        data = buf.slice(offset, end);
        offset = end;
      } else {
        data = buf.slice(offset);
        offset = buf.length;
      }
      frames.push({ type: "datagram", data });
    } else {
      frames.push({ type: "unknown", frameType: type });
      break;
    }
  }
  return frames;
}
function build_transport_params(params) {
  var out = [];
  function addParam(id, value) {
    var idBytes = writeVarInt(id);
    var valueBytes;
    if (typeof value === "number") {
      valueBytes = writeVarInt(value);
    } else if (value instanceof Uint8Array) {
      valueBytes = Array.from(value);
    } else if (value === true) {
      valueBytes = [];
    } else {
      throw new Error("Unsupported param value type for id " + id);
    }
    var lengthBytes = writeVarInt(valueBytes.length);
    out.push.apply(out, Array.from(idBytes));
    out.push.apply(out, Array.from(lengthBytes));
    out.push.apply(out, valueBytes);
  }
  if (params.original_destination_connection_id)
    addParam(0, params.original_destination_connection_id);
  if (params.max_idle_timeout)
    addParam(1, params.max_idle_timeout);
  if (params.stateless_reset_token)
    addParam(2, params.stateless_reset_token);
  if (params.max_udp_payload_size)
    addParam(3, params.max_udp_payload_size);
  if (params.initial_max_data)
    addParam(4, params.initial_max_data);
  if (params.initial_max_stream_data_bidi_local)
    addParam(5, params.initial_max_stream_data_bidi_local);
  if (params.initial_max_stream_data_bidi_remote)
    addParam(6, params.initial_max_stream_data_bidi_remote);
  if (params.initial_max_stream_data_uni)
    addParam(7, params.initial_max_stream_data_uni);
  if (params.initial_max_streams_bidi)
    addParam(8, params.initial_max_streams_bidi);
  if (params.initial_max_streams_uni)
    addParam(9, params.initial_max_streams_uni);
  if (params.ack_delay_exponent !== void 0)
    addParam(10, params.ack_delay_exponent);
  if (params.max_ack_delay !== void 0)
    addParam(11, params.max_ack_delay);
  if (params.disable_active_migration)
    addParam(12, true);
  if (params.active_connection_id_limit)
    addParam(14, params.active_connection_id_limit);
  if (params.initial_source_connection_id)
    addParam(15, params.initial_source_connection_id);
  if (params.retry_source_connection_id)
    addParam(16, params.retry_source_connection_id);
  if (params.max_datagram_frame_size)
    addParam(32, params.max_datagram_frame_size);
  return new Uint8Array(out);
}
function parse_transport_params(buf, start) {
  if (!(buf instanceof Uint8Array)) throw new Error("Expect Uint8Array");
  var offset = start || 0;
  var end = buf.length;
  var out = {};
  while (offset < end) {
    let vi = function(bytes) {
      var r = readVarInt(bytes, 0);
      return r ? r.value : 0;
    };
    var idVar = readVarInt(buf, offset);
    if (!idVar) break;
    offset += idVar.byteLength;
    var lenVar = readVarInt(buf, offset);
    if (!lenVar) break;
    offset += lenVar.byteLength;
    if (offset + lenVar.value > end) break;
    var valueBytes = buf.slice(offset, offset + lenVar.value);
    offset += lenVar.value;
    var id = idVar.value;
    switch (id) {
      case 0:
        out.original_destination_connection_id = valueBytes;
        break;
      case 1:
        out.max_idle_timeout = vi(valueBytes);
        break;
      case 2:
        out.stateless_reset_token = valueBytes;
        break;
      case 3:
        out.max_udp_payload_size = vi(valueBytes);
        break;
      case 4:
        out.initial_max_data = vi(valueBytes);
        break;
      case 5:
        out.initial_max_stream_data_bidi_local = vi(valueBytes);
        break;
      case 6:
        out.initial_max_stream_data_bidi_remote = vi(valueBytes);
        break;
      case 7:
        out.initial_max_stream_data_uni = vi(valueBytes);
        break;
      case 8:
        out.initial_max_streams_bidi = vi(valueBytes);
        break;
      case 9:
        out.initial_max_streams_uni = vi(valueBytes);
        break;
      case 10:
        out.ack_delay_exponent = vi(valueBytes);
        break;
      case 11:
        out.max_ack_delay = vi(valueBytes);
        break;
      case 12:
        out.disable_active_migration = true;
        break;
      case 14:
        out.active_connection_id_limit = vi(valueBytes);
        break;
      case 15:
        out.initial_source_connection_id = valueBytes;
        break;
      case 16:
        out.retry_source_connection_id = valueBytes;
        break;
      case 32:
        out.max_datagram_frame_size = vi(valueBytes);
        break;
      default:
        if (!out.unknown) out.unknown = [];
        out.unknown.push({ id, bytes: valueBytes });
    }
  }
  return out;
}

// node_modules/quico/src/tls_bridge.js
function defaultTransportParams() {
  return {
    max_udp_payload_size: 65527,
    max_idle_timeout: 3e4,
    initial_max_data: 1048576,
    initial_max_stream_data_bidi_local: 262144,
    initial_max_stream_data_bidi_remote: 262144,
    initial_max_stream_data_uni: 131072,
    initial_max_streams_bidi: 100,
    initial_max_streams_uni: 3,
    ack_delay_exponent: 3,
    max_ack_delay: 25,
    disable_active_migration: true,
    active_connection_id_limit: 4,
    max_datagram_frame_size: 65527
  };
}
function TLSBridge(options) {
  options = options || {};
  var ev = Emitter();
  var session = null;
  var handshakeSecretsEmitted = false;
  var appSecretsEmitted = false;
  var helloHandled = false;
  var isServer = !!options.isServer;
  var originalDcid = options.originalDcid || new Uint8Array(0);
  var localCid = options.localCid || new Uint8Array(0);
  var hostname = options.hostname || null;
  var rejectUnauthorized = options.rejectUnauthorized !== false;
  var ca = options.ca || null;
  var supportedAlpns = (function() {
    var a = options.alpn || ["h3"];
    return Array.isArray(a) ? a : [a];
  })();
  function feedMessage(data) {
    if (!session) {
      var sessionOpts = {
        isServer,
        SNICallback: options.SNICallback,
        rejectUnauthorized
      };
      if (ca) sessionOpts.ca = ca;
      if (!isServer) {
        sessionOpts.sessionId = new Uint8Array(0);
        if (hostname) sessionOpts.servername = hostname;
      }
      session = new tls_session_default(sessionOpts);
      setupSessionEvents();
      if (!isServer) {
        var tp = defaultTransportParams();
        tp.initial_source_connection_id = localCid;
        var quicParams = build_transport_params(tp);
        session.set_context({
          local_supported_versions: [772],
          local_supported_alpns: supportedAlpns,
          local_supported_groups: [29, 23, 24],
          local_supported_cipher_suites: [4865, 4866],
          local_extensions: [{ type: 57, data: quicParams }],
          // Signature schemes offered to the peer (client: in the ClientHello;
          // server: in CertificateRequest). Full modern list, ordered PSS/ECDSA/
          // EdDSA first, legacy pkcs1 last (TLS 1.2 compat only — TLS 1.3 never
          // signs pkcs1). Two bugs lived in the old pkcs1-only list:
          //   1. Cloudflare zones with ECDSA-only certs reject the ClientHello
          //      outright (alert 40 handshake_failure — seen live against
          //      speed.cloudflare.com; claude.ai worked only because that zone
          //      also carries an RSA cert).
          //   2. lemon-tls hardcodes THIS full list in the HRR CH2, and RFC 8446
          //      §4.1.2 requires CH2 to match CH1 exactly — offering a different
          //      list in CH1 made every HRR flow non-compliant.
          local_supported_signature_algorithms: [
            2052,
            2053,
            2054,
            // rsa_pss_rsae_sha256/384/512
            1027,
            1283,
            1539,
            // ecdsa_secp256r1/384r1/521r1
            2055,
            2056,
            // ed25519, ed448
            1025,
            1281,
            1537
            // rsa_pkcs1 (TLS 1.2 legacy)
          ]
        });
        helloHandled = true;
      }
    }
    if (data && data.length > 0) session.message(data);
  }
  function setupSessionEvents() {
    var peerParamsEmitted = false;
    session.on("handshakeMessage", function(type, data, message) {
      if (peerParamsEmitted || !message || !Array.isArray(message.extensions)) return;
      for (var i = 0; i < message.extensions.length; i++) {
        var e = message.extensions[i];
        if (e && (e.type === 57 || e.type === 57) && e.data) {
          try {
            var parsed = parse_transport_params(e.data, 0);
            peerParamsEmitted = true;
            if (DEBUG) console.log("[tls] peer transport params parsed (" + e.data.length + "B)");
            ev.emit("peerTransportParams", parsed);
          } catch (err) {
            if (DEBUG) console.log("[tls] peer transport params parse failed: " + err.message);
          }
          break;
        }
      }
    });
    session.on("hello", function() {
      if (helloHandled) return;
      helloHandled = true;
      if (DEBUG) console.log("[tls] hello \u2014 configuring TLS");
      var tp = defaultTransportParams();
      if (isServer) {
        tp.original_destination_connection_id = originalDcid;
        tp.initial_source_connection_id = originalDcid;
        tp.stateless_reset_token = new Uint8Array(16).fill(171);
      } else {
        tp.initial_source_connection_id = localCid;
      }
      var quicParams = build_transport_params(tp);
      var tlsContext = {
        local_supported_versions: [772],
        local_supported_alpns: supportedAlpns,
        local_supported_groups: [29, 23, 24],
        local_supported_cipher_suites: [4865, 4866, 49199, 49200, 52392],
        local_extensions: [
          { type: 57, data: quicParams }
        ],
        // Signature schemes offered to the peer (client: in the ClientHello;
        // server: in CertificateRequest). Full modern list, ordered PSS/ECDSA/
        // EdDSA first, legacy pkcs1 last (TLS 1.2 compat only — TLS 1.3 never
        // signs pkcs1). Two bugs lived in the old pkcs1-only list:
        //   1. Cloudflare zones with ECDSA-only certs reject the ClientHello
        //      outright (alert 40 handshake_failure — seen live against
        //      speed.cloudflare.com; claude.ai worked only because that zone
        //      also carries an RSA cert).
        //   2. lemon-tls hardcodes THIS full list in the HRR CH2, and RFC 8446
        //      §4.1.2 requires CH2 to match CH1 exactly — offering a different
        //      list in CH1 made every HRR flow non-compliant.
        local_supported_signature_algorithms: [
          2052,
          2053,
          2054,
          // rsa_pss_rsae_sha256/384/512
          1027,
          1283,
          1539,
          // ecdsa_secp256r1/384r1/521r1
          2055,
          2056,
          // ed25519, ed448
          1025,
          1281,
          1537
          // rsa_pkcs1 (TLS 1.2 legacy)
        ]
      };
      session.set_context(tlsContext);
    });
    session.on("message", function(epoch, seq, type, data) {
      var quicEpoch;
      if (epoch === 0) quicEpoch = "initial";
      else if (epoch === 1) quicEpoch = "handshake";
      else quicEpoch = "app";
      if (DEBUG) console.log("[tls] outgoing: epoch=" + quicEpoch + " type=" + type + " len=" + data.length);
      ev.emit("send", quicEpoch, data);
    });
    session.on("handshakeSecrets", function(localSecret, remoteSecret) {
      if (handshakeSecretsEmitted) return;
      handshakeSecretsEmitted = true;
      var cipher = session.getCipher();
      var hashName = TLS_CIPHER_SUITES2[cipher] ? TLS_CIPHER_SUITES2[cipher].hash : "sha256";
      if (DEBUG) console.log("[tls] handshake secrets ready");
      ev.emit("handshakeSecrets", { local: localSecret, remote: remoteSecret, cipher, hash: hashName });
    });
    session.on("appSecrets", function(localSecret, remoteSecret) {
      if (appSecretsEmitted) return;
      appSecretsEmitted = true;
      var cipher = session.getCipher();
      var hashName = TLS_CIPHER_SUITES2[cipher] ? TLS_CIPHER_SUITES2[cipher].hash : "sha256";
      if (DEBUG) console.log("[tls] app secrets ready");
      ev.emit("appSecrets", { local: localSecret, remote: remoteSecret, cipher, hash: hashName });
    });
    session.on("secureConnect", function() {
      if (DEBUG) console.log("[tls] secureConnect");
      ev.emit("secureConnect");
    });
    session.on("keyUpdate", function(info) {
      ev.emit("keyUpdate", info.direction, info.secret);
    });
    session.on("keylog", function(line) {
      ev.emit("keylog", line);
    });
  }
  return {
    on: function(name, fn) {
      ev.on(name, fn);
    },
    off: function(name, fn) {
      ev.off(name, fn);
    },
    feedMessage,
    requestKeyUpdate: function() {
      if (session) session.requestKeyUpdate(true);
    },
    getHandshakeSecrets: function() {
      if (!session) return null;
      var hs = session.getHandshakeSecrets();
      if (!hs || !hs.localSecret) return null;
      var cipher = session.getCipher();
      var hashName = TLS_CIPHER_SUITES2[cipher] ? TLS_CIPHER_SUITES2[cipher].hash : "sha256";
      return { local: hs.localSecret, remote: hs.remoteSecret, cipher, hash: hashName };
    },
    getTrafficSecrets: function() {
      if (!session) return null;
      var secrets = session.getTrafficSecrets();
      if (!secrets || !secrets.localAppSecret) return null;
      var cipher = session.getCipher();
      var hashName = TLS_CIPHER_SUITES2[cipher] ? TLS_CIPHER_SUITES2[cipher].hash : "sha256";
      return { local: secrets.localAppSecret, remote: secrets.remoteAppSecret, cipher, hash: hashName };
    },
    getCipher: function() {
      return session ? session.getCipher() : null;
    },
    close: function() {
      if (session && session.close) session.close();
    }
  };
}

// node_modules/quico/src/quic_connection.js
var DEBUG_BBR = DEBUG || typeof process !== "undefined" && process.env && !!process.env.QUICO_DEBUG_BBR;
function QUICConnection(options) {
  if (!(this instanceof QUICConnection)) return new QUICConnection(options);
  options = options || {};
  var ev = Emitter();
  var tls = null;
  var context = {
    isServer: options.isServer !== false,
    state: "idle",
    handshake_done: false,
    handshake_done_sent: false,
    // Connection close (RFC 9000 §10.2)
    close_frame: null,
    // the CONNECTION_CLOSE frame to (re)send while closing
    last_close_echo: 0,
    // timestamp throttle for closing-state CC echoes
    version: 1,
    original_dcid: null,
    my_cids: [],
    their_cids: [],
    // Keys
    initial_read: null,
    initial_write: null,
    handshake_read: null,
    handshake_write: null,
    app_read: null,
    app_write: null,
    app_prev_read: null,
    // previous read keys (kept during transition)
    key_phase: false,
    // our current send key_phase
    read_key_phase: false,
    // expected key_phase on incoming packets
    app_read_secret: null,
    // current read secret (for deriving next)
    app_write_secret: null,
    // current write secret (for deriving next)
    cipher_hash: "sha256",
    // hash for key derivation
    cipher_suite: null,
    // TLS cipher suite code (for key length)
    // Packet numbers — sending
    send_pn: { initial: 0, handshake: 0, app: 0 },
    // Packet numbers — receiving
    recv_pn_largest: { initial: -1, handshake: -1, app: -1 },
    recv_pn_ranges: { initial: [], handshake: [], app: [] },
    // CRYPTO
    crypto_chunks: { initial: {}, handshake: {} },
    // RECEIVE-side reassembly
    crypto_offset: { initial: 0, handshake: 0 },
    crypto_send_offset: { initial: 0, handshake: 0, app: 0 },
    // CRYPTO send-side loss recovery (Initial/Handshake spaces).
    // The app stream path retransmits "for free" — stream bytes stay in
    // send_streams and the round-robin re-scans them. CRYPTO is otherwise
    // fire-and-forget (cryptoWrite discards the bytes after one send), and the
    // handshake spaces have no expireInFlight. So we mirror the stream model on
    // a tiny per-space structure (same flat-ranges semantics, no stream id, no
    // FIN): retain sent bytes, track which PN carried which byte-range, expire
    // by time, and re-send missing ranges. A CRYPTO frame is just a STREAM frame
    // of a single id-less, fin-less stream — so the bookkeeping is identical.
    crypto_sent: {
      initial: { buf: [], in_flight: {}, acked: [], backoff: 0 },
      handshake: { buf: [], in_flight: {}, acked: [], backoff: 0 }
    },
    crypto_timer: null,
    // ACK
    pending_ack: { initial: [], handshake: [], app: [] },
    // Receiving streams
    recv_streams: {},
    // Sending streams
    send_streams: {},
    // In-flight tracking (Phase 1)
    sending_app_pn_in_flight: /* @__PURE__ */ new Set(),
    sending_app_pn_history: [],
    // [time_sent, encoded_len, delivered_at_send, delivered_time_at_send]
    delivered: 0,
    // cumulative app bytes acked — for BBR rate samples
    delivered_time: Date.now(),
    // wall-clock of the last delivered update (BBR delivery clock)
    // ── Burst / congestion-control knobs ───────────────────────────────────
    // Three layers (+ a floor):
    //   max_*     HARD CEILING — the programmer sets these; the CC NEVER exceeds
    //             them, whatever the network measurements say. Safety net against
    //             a CC bug, a pathological link, or memory blow-up.
    //   min_*     FLOOR — the CC never shrinks below this. Also prevents the
    //             deadlock where a cap < one packet rounds down to 0.
    //   init_*    STARTING point of the current_* values at each new connection.
    //   current_* RUNTIME values the CC rewrites (≈ every RTT). Always clamped to
    //             [min_, max_]. The send loop reads min(current_, max_), so the
    //             moment Phase 4b starts writing current_* it takes effect with no
    //             further wiring.
    //
    // Naming: <when>_limit_<noun>. The qualifiers (when=max/min/init/current, and the
    // word `limit`) all sit up front; the noun (bytes_in_flight / packets_per_sec /
    // packet_payload) stays whole at the end. This keeps `current_limit_bytes_in_flight`
    // (the CC's CEILING) clearly distinct from the live `bytesInFlight` it gates against.
    //
    // What each algorithm owns:
    //   current_limit_*_in_flight   (cwnd)        ← Phase 4b  (BBR-lite: ≈ 2·BtlBw·min_rtt)
    //   current_limit_*_per_sec     (pacing rate) ← Phase 4b  (BBR-lite: ≈ BtlBw)
    //   current_limit_packet_payload (MTU)        ← DPLPMTUD  (separate, later)
    // Until those algorithms run, init_* = max_* so behavior is the static default.
    // When 4b lands, lower the in-flight init_* toward IW10 (~10 pkts / ~14 KB)
    // and let the algorithm climb from there.
    max_packets_per_burst: 20,
    // fixed cap — not CC-controlled, no current_/init_
    // packet payload (MTU). current_ is the size actually used; max_ is the ceiling
    // DPLPMTUD must not probe past; init_/floor is QUIC's guaranteed 1200-byte minimum.
    max_limit_packet_payload: 1452,
    // ceiling (IPv6-safe Ethernet: 1500 − 48 hdr)
    init_limit_packet_payload: 1200,
    // QUIC guaranteed floor — where we start
    current_limit_packet_payload: 1200,
    // = init_; DPLPMTUD raises toward max_
    // in-flight window (cwnd) — bytes is the primary signal; packets kept coherent.
    // init_/current_ start at IW10 (RFC 9002 initial window, ~10 pkts) and BBR-lite
    // climbs from there toward 2·BDP; max_ is the hard ceiling, min_ the floor.
    max_limit_packets_in_flight: 256,
    // ceiling ≈ 300 KB at 1200 B/pkt
    min_limit_packets_in_flight: 2,
    // floor (RFC 9002 min cwnd)
    init_limit_packets_in_flight: 10,
    // IW10
    current_limit_packets_in_flight: 10,
    // = init_; BBR rewrites at round-end
    max_limit_bytes_in_flight: 3e5,
    // ceiling ~300 KB — coherent with packets ↑
    min_limit_bytes_in_flight: 2400,
    // floor ~2 packets
    init_limit_bytes_in_flight: 12e3,
    // IW10 (10 × 1200 B)
    current_limit_bytes_in_flight: 12e3,
    // = init_; BBR rewrites at round-end
    // pacing rate
    max_limit_packets_per_sec: 12e3,
    // ceiling ≈ 14 MB/s
    min_limit_packets_per_sec: 10,
    // floor — avoid 0/deadlock
    init_limit_packets_per_sec: 12e3,
    current_limit_packets_per_sec: 12e3,
    // = init_; BBR rewrites at round-end
    max_limit_bytes_per_sec: 14e6,
    // ceiling ~14 MB/s — coherent ↑
    min_limit_bytes_per_sec: 12e3,
    // floor ~96 kbps — avoid 0/deadlock
    init_limit_bytes_per_sec: 14e6,
    current_limit_bytes_per_sec: 14e6,
    // = init_; BBR rewrites at round-end
    burst_timer: null,
    pacing_tokens: 0,
    // token-bucket pacer: accumulated send credit (bytes)
    pacing_last_refill: Date.now(),
    // Pending app packets
    pending_app_packets: [],
    // Flow control — connection level (RFC 9000 §4.1)
    bytes_sent: 0,
    // total STREAM bytes sent (raw stat, incl. retransmits)
    // max_data_sent: connection-level FC USAGE — the sum of per-stream
    // high-water marks (highest offset sent on each stream). RFC 9000 §4.1
    // counts usage by highest offset, NOT bytes on the wire: retransmissions
    // re-send offsets that were already inside the allowance, so they must not
    // advance this counter. bytes_sent above (which does include retransmits)
    // previously doubled as the FC counter — under loss that inflated usage
    // until sending stalled with budget the peer had actually granted.
    max_data_sent: 0,
    bytes_received: 0,
    // total STREAM bytes *received off the wire* (incl. out-of-order)
    remote_max_data: 1048576,
    // peer's limit on what we can send (default 1MB until parsed)
    // ── Flow control, receive side (RFC 9000 §4.1) — consumption-based
    // sliding window (the ngtcp2/quiche scheme; replaces the old unbounded
    // ×2 doubling, which never actually limited the peer and grew forever).
    //
    // Three numbers per level:
    //   window (W)  — fixed size, = the value in our transport params.
    //   consumed    — bytes DELIVERED IN-ORDER to the application (advances in
    //                 flushStream), NOT bytes received off the wire. Data can
    //                 arrive out of order and park in the buffer unconsumed —
    //                 exactly what the window must bound (memory).
    //   advertised  — the limit last sent to the peer (local_max_data below /
    //                 per-stream local_max_stream_data). Slides forward by
    //                 `advertised = consumed + W` once consumed passes half a
    //                 window since the last update (hysteresis).
    //
    // USAGE (what the peer is measured against) counts by HIGHEST OFFSET per
    // stream (fc_recv_usage = Σ max_recv_offset), not bytes-on-the-wire —
    // retransmissions must not advance it. Exceeding `advertised` on either
    // level is a protocol violation → CONNECTION_CLOSE FLOW_CONTROL_ERROR
    // (0x03). A peer stalled because we haven't consumed sends DATA_BLOCKED /
    // STREAM_DATA_BLOCKED, answered by re-sending the current advertised —
    // that pairing (see the frame handlers) is what makes a lost window
    // update recoverable.
    local_max_data: 1048576,
    // ADVERTISED conn limit (starts = window, from transport params)
    local_max_data_window: 1048576,
    // W — fixed; matches initial_max_data we advertise
    local_max_data_consumed: 0,
    // in-order bytes delivered to the app (all streams)
    fc_recv_usage: 0,
    // Σ per-stream max_recv_offset — the peer's usage
    //
    // Flow control — stream level (RFC 9000 §4.1)
    local_initial_max_stream_data: 262144,
    // matches transport params; doubled on MAX_STREAM_DATA updates
    remote_max_streams_bidi: 100,
    remote_max_streams_uni: 3,
    // ── Per-stream send-side flow control (RFC 9000 §4.1) — the peer's limits
    // on what WE may send per stream. Seeded from the peer's transport params
    // (initial_max_stream_data_*, mapped by stream direction/initiator in
    // initialStreamSendLimit), then raised by MAX_STREAM_DATA frames. The RFC
    // default for an omitted param is 0 — a peer that doesn't grant, grants
    // nothing (in practice params always arrive during the handshake, before
    // any app data can flow).
    peer_initial_max_stream_data_bidi_local: 0,
    peer_initial_max_stream_data_bidi_remote: 0,
    peer_initial_max_stream_data_uni: 0,
    // MAX_STREAM_DATA values keyed by stream id (monotonic). Lives outside the
    // stream object so a frame that arrives BEFORE the stream is created is
    // still honored at creation time. Entries are dropped when the stream is
    // fully acked / stopped.
    remote_max_stream_data_by_sid: {},
    // FC-blocked signaling (DATA_BLOCKED / STREAM_DATA_BLOCKED, RFC 9000 §4.1).
    // Set by get_stream_chunks when a window clamp actually binds; consumed by
    // maybeSendBlockedFrames after each burst pass. This doubles as our loss
    // recovery for window updates: MAX_DATA / MAX_STREAM_DATA are sent once
    // and never retransmitted, so a lost update would stall the sender forever
    // — the repeated (rate-limited) BLOCKED frame prompts the peer to re-send
    // its current limit.
    fc_blocked_conn: false,
    // conn-level budget bound this pass
    last_data_blocked_sent: 0,
    // rate-limit timestamp (connection)
    last_stream_blocked_sent: {},
    // sid → rate-limit timestamp (per stream)
    // RTT estimate (RFC 9002 §5), updated incrementally on every new sample.
    // null = no sample yet. Replaces the old raw rtt_history log: the EWMA below
    // keeps the needed history implicitly, so per-sample storage isn't needed.
    srtt: null,
    rttvar: null,
    min_rtt: null,
    latest_rtt: null,
    max_ack_delay: 25,
    // ms; seeded from the peer's transport params (max_ack_delay) once parsed
    peer_ack_delay_exponent: 3,
    // seeded from the peer's transport params; ACK Delay = field × 2^this µs
    // --- Raw network observations (collected for the future congestion
    // controller; NOT acted on here). Flat on context, like the RTT fields.
    // Counters are cumulative; rates/extents are derived later over a window. ---
    max_rtt: null,
    // paired with min_rtt — the gap reveals bufferbloat
    latest_delivery_rate: null,
    // bytes/sec acked in the most recent ACK sample
    max_delivery_rate: null,
    // peak delivery rate ≈ BtlBw (a CC bandwidth input)
    lost_count: 0,
    // packets declared lost by expireInFlight (≈ loss)
    // Expired-but-unacknowledged packets ("limbo"). When expireInFlight times a
    // packet out, its stream spans are parked here instead of being forgotten.
    // If the ACK then arrives late — which on a queued path it regularly does,
    // since the expiry timer races the ACK's arrival — the spans are credited
    // to `delivered` and marked acked, cancelling any not-yet-sent retransmit.
    //
    // Without this, a spuriously-expired packet's bytes vanish from delivery
    // accounting forever: the ACK finds nothing to credit, BtlBw (computed
    // from `delivered`) reads a collapsing rate, the pacer follows it down,
    // and the sender relaxes the queue until ACKs beat the timer again — a
    // relaxation oscillator, measured against quic-go through the interop
    // simulator as a 114/4-packets-per-second sawtooth and ~21× duplication.
    //   pn → { t: expiry wall-time, spans: [[sid, from, to], ...] }
    expired_unacked: {},
    reorder_in_count: 0,
    // app packets that arrived below the highest PN seen (network reordering, peer→us)
    // --- BBR-lite measurement (Phase 4b, step 1+2 — measure only, no control). ---
    // BBR models the path from two measured quantities and derives the BDP:
    //   BDP = BtlBw × RTprop.  BtlBw = windowed-MAX delivery rate (≈ bottleneck
    //   bandwidth); RTprop = windowed-MIN RTT (≈ propagation, queue-free). Both use
    //   windows so a stale peak/min decays: a forever-max would never drop when the
    //   link slows, a forever-min would never rise as the true RTT changes.
    bbr_round_count: 0,
    // round-trip counter; one round ≈ one RTT elapsed
    bbr_round_start_pn: 0,
    // round completes when an ACK's largest >= this
    bbr_round_start_delivered: 0,
    // context.delivered at round start (for per-round rate)
    bbr_round_start_time: Date.now(),
    // wall-clock at round start (for per-round rate)
    bbr_btlbw_samples: [],
    // [{round, rate}] — per-ACK delivery-rate samples
    bbr_btlbw: null,
    // windowed-max delivery rate over the last N rounds (≈ BtlBw)
    bbr_min_rtt: null,
    // windowed-min RTT over ~10s (≈ RTprop)
    bbr_min_rtt_stamp: 0,
    // when bbr_min_rtt was last (re)set
    bbr_bdp: null,
    // derived BtlBw × min_rtt (bytes) — the in-flight target
    // BBR-lite state machine. Startup ramps exponentially (high gain) to discover
    // BtlBw; once it plateaus (no ≥25% growth for 3 rounds) the pipe is full, so
    // Drain removes the queue Startup built, then ProbeBW holds steady at the
    // bottleneck rate. Without Startup, writing cwnd from an under-saturated
    // measurement death-spirals to the floor (the link never gets filled).
    bbr_state: "startup",
    // 'startup' | 'drain' | 'probe_bw'
    bbr_full_bw: 0,
    // highest BtlBw seen — Startup plateau detector
    bbr_full_bw_count: 0,
    // consecutive rounds without ≥25% BtlBw growth
    bbr_cycle_idx: 0,
    // ProbeBW pacing-gain cycle position (0..7)
    // Timers
    idle_timeout: options.idleTimeout || 3e4,
    handshake_timeout: options.handshakeTimeout || 1e4,
    last_activity: Date.now(),
    // Time of the most recent ACK received from the peer (set only in
    // processAckFrame). Drives the in-flight-expiry backoff: while the peer
    // isn't ACKing us, the retransmit timeout widens so we don't flood a dead
    // path. Distinct from last_activity (which also bumps on send/receive).
    last_ack_time: Date.now(),
    idle_timer: null,
    handshake_timer: null,
    // Keep-alive: when > 0, send a PING after this many ms of inactivity to
    // keep the connection from idling out (RFC 9000 §10.1.2). Should be < the
    // idle timeout. options.keepAlive: true → idle_timeout/2; a number → ms.
    keep_alive_interval: (function() {
      var k2 = options.keepAlive;
      if (k2 === true) return Math.max(1e3, Math.floor((options.idleTimeout || 3e4) / 2));
      if (typeof k2 === "number" && k2 > 0) return k2;
      return 0;
    })(),
    keep_alive_timer: null,
    SNICallback: options.SNICallback || null,
    hostname: options.hostname || null,
    // Client-side peer certificate verification. Defaults to true (node:tls
    // semantics); set false for self-signed certs, private CAs, or interop.
    rejectUnauthorized: options.rejectUnauthorized !== false,
    ca: options.ca || null,
    // ALPN protocol(s) to advertise in the TLS handshake.
    // Defaults to ['h3'] (HTTP/3). Other QUIC-based protocols set their own,
    // e.g. 'doq' for DNS-over-QUIC (RFC 9250). Accepts a string or array.
    alpn: (function() {
      var a = options.alpn || ["h3"];
      return Array.isArray(a) ? a : [a];
    })()
  };
  function set_context(updates) {
    if (!updates || typeof updates !== "object") return;
    var changed = {};
    if ("state" in updates && updates.state !== context.state) {
      context.state = updates.state;
      changed.state = true;
    }
    if ("handshake_done" in updates && updates.handshake_done !== context.handshake_done) {
      context.handshake_done = updates.handshake_done;
      changed.handshake_done = true;
    }
    if ("handshake_done_sent" in updates) {
      context.handshake_done_sent = updates.handshake_done_sent;
    }
    if ("original_dcid" in updates && updates.original_dcid !== null && context.original_dcid === null) {
      context.original_dcid = updates.original_dcid;
      changed.original_dcid = true;
    }
    if ("version" in updates && updates.version !== context.version) {
      context.version = updates.version;
    }
    if ("add_their_cid" in updates) {
      var cid = updates.add_their_cid;
      var found = false;
      for (var i = 0; i < context.their_cids.length; i++) {
        if (uint8Equal(cid, context.their_cids[i])) {
          found = true;
          break;
        }
      }
      if (!found) context.their_cids.push(cid);
    }
    if ("initial_read" in updates) {
      context.initial_read = updates.initial_read;
      changed.initial_read = true;
    }
    if ("initial_write" in updates) {
      context.initial_write = updates.initial_write;
      changed.initial_write = true;
    }
    if ("handshake_read" in updates) {
      context.handshake_read = updates.handshake_read;
    }
    if ("handshake_write" in updates) {
      context.handshake_write = updates.handshake_write;
    }
    if ("app_read" in updates) {
      context.app_read = updates.app_read;
    }
    if ("app_write" in updates) {
      context.app_write = updates.app_write;
    }
    if ("remote_max_data" in updates && updates.remote_max_data > context.remote_max_data) {
      context.remote_max_data = updates.remote_max_data;
      changed.remote_max_data = true;
    }
    if ("remote_max_streams_bidi" in updates) {
      context.remote_max_streams_bidi = updates.remote_max_streams_bidi;
    }
    if ("remote_max_streams_uni" in updates) {
      context.remote_max_streams_uni = updates.remote_max_streams_uni;
    }
    if ("key_phase" in updates && updates.key_phase !== context.key_phase) {
      context.key_phase = updates.key_phase;
      changed.key_phase = true;
    }
    if (changed.initial_read || changed.initial_write) {
      if (context.state === "idle") {
        context.state = "handshaking";
        changed.state = true;
      }
    }
    if (changed.handshake_done && context.handshake_done === true) {
      if (DEBUG) console.log("[quic] handshake done \u2014 flushing " + context.pending_app_packets.length + " pending");
      if (context.pending_app_packets.length > 0) {
        var pending = context.pending_app_packets;
        context.pending_app_packets = [];
        for (var i = 0; i < pending.length; i++) {
          processDecryptedPacket("app", pending[i].packet_number, pending[i].plaintext);
        }
      }
      startIdleTimer();
      startKeepAliveTimer();
    }
    if (changed.state && context.state === "connected") {
    }
    if (changed.state && (context.state === "draining" || context.state === "closing")) {
      clearIdleTimer();
      stopCryptoRetx();
      var _drainTimer = setTimeout(function() {
        if (context.state === "draining" || context.state === "closing") {
          context.state = "closed";
          ev.emit("close");
        }
      }, Math.min(3e3, context.idle_timeout / 3));
      if (_drainTimer.unref) _drainTimer.unref();
    }
    if (changed.state && context.state === "closed") {
      clearIdleTimer();
      ev.emit("close");
    }
    if (changed.remote_max_data) {
      plan_quic_burst();
    }
    if (changed.key_phase) {
      if (context.app_write_secret) {
        var next = quic_derive_key_update(context.app_write_secret, context.cipher_hash, context.cipher_suite);
        if (DEBUG) console.log("[quic] key update initiated \u2014 new write keys");
        context.app_write = { key: next.key, iv: next.iv, hp: context.app_write.hp };
        context.app_write_secret = next.secret;
      }
    }
  }
  function touchActivity() {
    context.last_activity = Date.now();
  }
  function startIdleTimer() {
    clearIdleTimer();
    if (context.idle_timeout <= 0) return;
    context.idle_timer = setInterval(function() {
      if (Date.now() - context.last_activity >= context.idle_timeout) {
        if (DEBUG) console.log("[quic] idle timeout");
        close(0, "idle timeout");
      }
    }, Math.max(1e3, Math.floor(context.idle_timeout / 4)));
    if (context.idle_timer.unref) context.idle_timer.unref();
  }
  function startKeepAliveTimer() {
    if (context.keep_alive_interval <= 0) return;
    if (context.keep_alive_timer !== null) return;
    context.keep_alive_timer = setInterval(function() {
      if (context.state !== "connected") return;
      if (Date.now() - context.last_activity >= context.keep_alive_interval) {
        if (DEBUG) console.log("[quic] keep-alive PING");
        sendFrames("app", [{ type: "ping" }]);
      }
    }, context.keep_alive_interval);
    if (context.keep_alive_timer.unref) context.keep_alive_timer.unref();
  }
  function clearIdleTimer() {
    if (context.idle_timer !== null) {
      clearInterval(context.idle_timer);
      context.idle_timer = null;
    }
    if (context.keep_alive_timer !== null) {
      clearInterval(context.keep_alive_timer);
      context.keep_alive_timer = null;
    }
  }
  function initTLS() {
    if (context.handshake_timeout > 0 && !context.handshake_timer) {
      context.handshake_timer = setTimeout(function() {
        if (context.state !== "connected" && context.state !== "closed" && context.state !== "draining" && context.state !== "closing") {
          if (DEBUG) console.log("[quic] handshake timeout (" + context.handshake_timeout + "ms)");
          ev.emit("error", new Error("QUIC handshake timeout"));
          close(256, "handshake timeout");
        }
      }, context.handshake_timeout);
      if (context.handshake_timer.unref) context.handshake_timer.unref();
    }
    tls = new TLSBridge({
      isServer: context.isServer,
      SNICallback: context.SNICallback,
      originalDcid: context.original_dcid,
      localCid: context.my_cids.length > 0 ? context.my_cids[0] : new Uint8Array(0),
      hostname: context.hostname,
      alpn: context.alpn,
      rejectUnauthorized: context.rejectUnauthorized,
      ca: context.ca
    });
    tls.on("send", function(epoch, data) {
      cryptoWrite(epoch, data);
    });
    tls.on("keylog", function(line) {
      ev.emit("keylog", line);
    });
    tls.on("peerTransportParams", function(p) {
      if (typeof p.ack_delay_exponent === "number") {
        context.peer_ack_delay_exponent = Math.max(0, Math.min(20, p.ack_delay_exponent));
      }
      if (typeof p.max_ack_delay === "number" && p.max_ack_delay >= 0) {
        context.max_ack_delay = Math.min(p.max_ack_delay, 16384);
      }
      if (typeof p.initial_max_data === "number") {
        context.remote_max_data = p.initial_max_data;
      }
      if (typeof p.initial_max_stream_data_bidi_local === "number") {
        context.peer_initial_max_stream_data_bidi_local = p.initial_max_stream_data_bidi_local;
      }
      if (typeof p.initial_max_stream_data_bidi_remote === "number") {
        context.peer_initial_max_stream_data_bidi_remote = p.initial_max_stream_data_bidi_remote;
      }
      if (typeof p.initial_max_stream_data_uni === "number") {
        context.peer_initial_max_stream_data_uni = p.initial_max_stream_data_uni;
      }
      if (typeof p.initial_max_streams_bidi === "number") {
        context.remote_max_streams_bidi = p.initial_max_streams_bidi;
      }
      if (typeof p.initial_max_streams_uni === "number") {
        context.remote_max_streams_uni = p.initial_max_streams_uni;
      }
      for (var rsid in context.send_streams) {
        var rst = context.send_streams[rsid];
        var seeded = initialStreamSendLimit(Number(rsid));
        if (seeded > rst.remote_max_stream_data) rst.remote_max_stream_data = seeded;
      }
      plan_quic_burst();
      if (DEBUG) console.log("[quic] peer params: ack_delay_exp=" + context.peer_ack_delay_exponent + " max_ack_delay=" + context.max_ack_delay + " remote_max_data=" + context.remote_max_data + " msd_bidi_local=" + context.peer_initial_max_stream_data_bidi_local + " msd_bidi_remote=" + context.peer_initial_max_stream_data_bidi_remote + " msd_uni=" + context.peer_initial_max_stream_data_uni);
    });
    tls.on("handshakeSecrets", function(secrets) {
      set_context({
        handshake_read: quic_derive_from_tls_secrets(secrets.remote, secrets.hash, secrets.cipher),
        handshake_write: quic_derive_from_tls_secrets(secrets.local, secrets.hash, secrets.cipher)
      });
    });
    tls.on("appSecrets", function(secrets) {
      if (context.handshake_timer) {
        clearTimeout(context.handshake_timer);
        context.handshake_timer = null;
      }
      context.app_read_secret = secrets.remote;
      context.app_write_secret = secrets.local;
      context.cipher_hash = secrets.hash;
      context.cipher_suite = secrets.cipher;
      set_context({
        app_read: quic_derive_from_tls_secrets(secrets.remote, secrets.hash, secrets.cipher),
        app_write: quic_derive_from_tls_secrets(secrets.local, secrets.hash, secrets.cipher),
        state: "connected",
        handshake_done: true
      });
      if (context.isServer) {
        ev.emit("connect");
      }
    });
    tls.on("secureConnect", function() {
      if (!context.isServer) {
        plan_quic_burst();
        ev.emit("connect");
      }
    });
  }
  function feedDatagram(from_ip, from_port, data) {
    if (DEBUG) console.log("[quic] datagram from " + from_ip + ":" + from_port + " len=" + data.length);
    feedPackets(from_ip, from_port, parse_quic_datagram(data));
  }
  function feedPackets(from_ip, from_port, packets) {
    if (context.state === "closed" || context.state === "draining") return;
    if (context.state === "closing") {
      if (Date.now() - context.last_close_echo >= 200) sendConnectionClose();
      return;
    }
    touchActivity();
    for (var i = 0; i < packets.length; i++) {
      if (packets[i] !== null) {
        try {
          feedPacket(packets[i]);
        } catch (e) {
          if (DEBUG) console.log("[quic] dropped packet \u2014 processing error: " + (e && e.message));
        }
      }
    }
  }
  function feedPacket(pkt) {
    if (context.state === "draining" || context.state === "closed") return;
    if (pkt.version && pkt.version !== context.version) set_context({ version: pkt.version });
    if (pkt.dcid && pkt.dcid.byteLength > 0) set_context({ original_dcid: pkt.dcid });
    if (pkt.scid && pkt.scid.byteLength > 0) set_context({ add_their_cid: pkt.scid });
    var space = pkt.type === "initial" ? "initial" : pkt.type === "handshake" ? "handshake" : pkt.type === "1rtt" ? "app" : null;
    if (!space) return;
    if (space === "initial" && !context.initial_read && context.original_dcid) {
      set_context({
        initial_read: quic_derive_init_secrets(context.original_dcid, context.version, "read"),
        initial_write: quic_derive_init_secrets(context.original_dcid, context.version, "write")
      });
    }
    var readKeys = space === "initial" ? context.initial_read : space === "handshake" ? context.handshake_read : context.app_read;
    if (!readKeys) return;
    var recvCid = context.isServer ? context.original_dcid : context.my_cids.length > 0 ? context.my_cids[0] : context.original_dcid;
    var decrypted = decrypt_quic_packet(
      pkt.raw,
      readKeys.key,
      readKeys.iv,
      readKeys.hp,
      recvCid,
      context.recv_pn_largest[space]
    );
    if ((!decrypted || !decrypted.plaintext) && space === "app" && context.app_read_secret) {
      var next = quic_derive_key_update(context.app_read_secret, context.cipher_hash, context.cipher_suite);
      decrypted = decrypt_quic_packet(
        pkt.raw,
        next.key,
        next.iv,
        readKeys.hp,
        // HP doesn't change
        recvCid,
        context.recv_pn_largest[space]
      );
      if (decrypted && decrypted.plaintext && decrypted.plaintext.byteLength > 0) {
        if (DEBUG) console.log("[quic] key update detected \u2014 installing new read keys");
        context.app_prev_read = context.app_read;
        context.app_read = { key: next.key, iv: next.iv, hp: readKeys.hp };
        context.app_read_secret = next.secret;
        context.read_key_phase = !context.read_key_phase;
        set_context({ key_phase: !context.key_phase });
      }
    }
    if ((!decrypted || !decrypted.plaintext) && space === "app" && context.app_prev_read) {
      decrypted = decrypt_quic_packet(
        pkt.raw,
        context.app_prev_read.key,
        context.app_prev_read.iv,
        context.app_prev_read.hp,
        recvCid,
        context.recv_pn_largest[space]
      );
    }
    if (!decrypted || !decrypted.plaintext || decrypted.plaintext.byteLength === 0) {
      if (DEBUG) console.log("[quic] decrypt failed: " + space + " raw_len=" + pkt.raw.byteLength + " first20=" + Array.from(pkt.raw.slice(0, 20)).map(function(b) {
        return b.toString(16).padStart(2, "0");
      }).join(" ") + " recv_cid_len=" + (recvCid ? recvCid.byteLength : "null") + " has_keys=" + !!readKeys + " largest_pn=" + context.recv_pn_largest[space]);
      return;
    }
    if (DEBUG) console.log("[quic] decrypted " + space + " pn=" + decrypted.packet_number + " len=" + decrypted.plaintext.byteLength);
    var pn = decrypted.packet_number;
    var ranges = context.recv_pn_ranges[space];
    var isNew = true;
    for (var ri = 0; ri < ranges.length; ri += 2) {
      if (pn >= ranges[ri] && pn < ranges[ri + 1]) {
        isNew = false;
        break;
      }
    }
    if (isNew) {
      flat_ranges_default.add(ranges, [pn, pn + 1]);
      if (pn > context.recv_pn_largest[space]) {
        context.recv_pn_largest[space] = pn;
      } else if (space === "app") {
        context.reorder_in_count++;
      }
    }
    if (DEBUG) console.log("[quic] pn=" + pn + " isNew=" + isNew);
    if (!isNew) return;
    if (space === "app" && !context.handshake_done) {
      context.pending_app_packets.push(decrypted);
      return;
    }
    processDecryptedPacket(space, pn, decrypted.plaintext);
  }
  function processDecryptedPacket(space, packetNumber, plaintext) {
    var frames = parse_quic_frames(plaintext);
    if (DEBUG) console.log("[quic] frames: " + space + " pn=" + packetNumber + " [" + frames.map(function(f) {
      return f.type;
    }).join(",") + "]");
    var ackEliciting = false;
    if (context.isServer && space === "app" && !context.handshake_done_sent) {
      set_context({ handshake_done_sent: true });
      sendFrames("app", [{ type: "handshake_done" }]);
    }
    for (var i = 0; i < frames.length; i++) {
      var frame = frames[i];
      if (frame.type === "crypto") {
        ackEliciting = true;
        processCryptoFrame(space, frame.offset, frame.data);
      } else if (frame.type === "stream") {
        ackEliciting = true;
        processStreamFrame(frame);
      } else if (frame.type === "ack") {
        processAckFrame(space, frame);
      } else if (frame.type === "ping") {
        ackEliciting = true;
      } else if (frame.type === "handshake_done") {
        ackEliciting = true;
      } else if (frame.type === "path_challenge") {
        ackEliciting = true;
        sendFrames(space, [{ type: "path_response", data: frame.data }]);
      } else if (frame.type === "new_connection_id") {
        ackEliciting = true;
      } else if (frame.type === "connection_close") {
        if (DEBUG) console.log("[quic] CONNECTION_CLOSE error=0x" + (frame.error || 0).toString(16) + " frame_type=0x" + (frame.frameType || 0).toString(16) + ' reason="' + (frame.reason || "") + '"');
        set_context({ state: "draining" });
        return;
      } else if (frame.type === "stop_sending") {
        ackEliciting = true;
        if (frame.id in context.send_streams) {
          if (DEBUG) console.log("[quic] STOP_SENDING stream=" + frame.id + " error=" + frame.error);
          delete context.send_streams[frame.id];
          delete context.remote_max_stream_data_by_sid[frame.id];
          delete context.last_stream_blocked_sent[frame.id];
        }
      } else if (frame.type === "reset_stream") {
        ackEliciting = true;
        if (frame.id in context.recv_streams) {
          if (DEBUG) console.log("[quic] RESET_STREAM stream=" + frame.id + " error=" + frame.error);
          delete context.recv_streams[frame.id];
        }
      } else if (frame.type === "max_data") {
        ackEliciting = true;
        set_context({ remote_max_data: frame.max });
      } else if (frame.type === "max_streams_bidi") {
        ackEliciting = true;
        set_context({ remote_max_streams_bidi: frame.max });
      } else if (frame.type === "max_streams_uni") {
        ackEliciting = true;
        set_context({ remote_max_streams_uni: frame.max });
      } else if (frame.type === "max_stream_data") {
        ackEliciting = true;
        var msdPrev = context.remote_max_stream_data_by_sid[frame.id] || 0;
        if (frame.max > msdPrev) context.remote_max_stream_data_by_sid[frame.id] = frame.max;
        var msdStream = context.send_streams[frame.id];
        if (msdStream && frame.max > msdStream.remote_max_stream_data) {
          msdStream.remote_max_stream_data = frame.max;
          plan_quic_burst();
        }
      } else if (frame.type === "data_blocked") {
        ackEliciting = true;
        sendFrames("app", [{ type: "max_data", max: context.local_max_data }]);
      } else if (frame.type === "stream_data_blocked") {
        ackEliciting = true;
        var sdbStream = context.recv_streams[frame.id];
        var sdbLimit = sdbStream ? sdbStream.local_max_stream_data : context.local_initial_max_stream_data;
        sendFrames("app", [{ type: "max_stream_data", id: Number(frame.id), max: sdbLimit }]);
      } else if (frame.type === "datagram") {
        ackEliciting = true;
        ev.emit("datagram", frame.data);
      }
    }
    if (ackEliciting) {
      flat_ranges_default.add(context.pending_ack[space], [packetNumber, packetNumber + 1]);
      var pa = context.pending_ack[space];
      var MAX_ACK_RANGES = 32;
      if (pa.length > MAX_ACK_RANGES * 2) pa.splice(0, pa.length - MAX_ACK_RANGES * 2);
      var ackFrame = ranges_to_ack_frame(context.pending_ack[space], null, 0);
      if (ackFrame) {
        sendFrames(space, [ackFrame]);
        if (space !== "app") context.pending_ack[space] = [];
      }
    }
  }
  function processCryptoFrame(space, offset, data) {
    if (space !== "initial" && space !== "handshake") return;
    if (DEBUG) console.log("[quic] CRYPTO: space=" + space + " offset=" + offset + " len=" + data.length);
    var chunks = context.crypto_chunks[space];
    var fromOffset = context.crypto_offset[space];
    if (!(offset in chunks) || chunks[offset].byteLength < data.byteLength) chunks[offset] = data;
    var result = extract_tls_messages_from_chunks(chunks, fromOffset);
    if (DEBUG) console.log("[quic] TLS messages: " + (result ? result.tls_messages.length : "none"));
    if (!result) return;
    context.crypto_offset[space] = result.new_from_offset;
    if (!tls) {
      if (DEBUG) console.log("[quic] initializing TLS bridge");
      initTLS();
    }
    for (var i = 0; i < result.tls_messages.length; i++) {
      var msg = result.tls_messages[i];
      var msgType = msg[0];
      if (DEBUG) console.log("[quic] \u2192 TLS msg #" + i + " type=0x" + msgType.toString(16) + " len=" + msg.length);
      if (msgType === 2 && msg.length >= 38) {
        var hrrRandom = [207, 33, 173, 116, 229, 154, 97, 17, 190, 29, 140, 2, 30, 101, 184, 145, 194, 162, 17, 22, 122, 187, 140, 94, 7, 158, 9, 226, 200, 168, 51, 156];
        var isHRR = true;
        for (var j = 0; j < 32; j++) {
          if (msg[6 + j] !== hrrRandom[j]) {
            isHRR = false;
            break;
          }
        }
        if (isHRR && DEBUG) console.log("[quic] \u26A0\uFE0F  HelloRetryRequest detected! LemonTLS needs HRR support.");
      }
      tls.feedMessage(msg);
    }
  }
  function processStreamFrame(frame) {
    var sid = frame.id;
    if (!(sid in context.recv_streams)) {
      context.recv_streams[sid] = {
        chunks: {},
        ranges: [],
        total_size: 0,
        flushed_to: 0,
        fin_emitted: false,
        // end-of-stream delivered to the app exactly once
        max_recv_offset: 0,
        // highest offset seen — the peer's FC usage on this stream
        local_max_stream_data: context.local_initial_max_stream_data
      };
    }
    var stream = context.recv_streams[sid];
    var newHigh = frame.offset + frame.data.length;
    if (newHigh > stream.max_recv_offset) {
      if (newHigh > stream.local_max_stream_data) {
        if (DEBUG) console.log("[quic] FC violation: stream " + sid + " offset " + newHigh + " > advertised " + stream.local_max_stream_data);
        close(3, "stream flow control exceeded");
        return;
      }
      var fcDelta = newHigh - stream.max_recv_offset;
      if (context.fc_recv_usage + fcDelta > context.local_max_data) {
        if (DEBUG) console.log("[quic] FC violation: connection usage " + (context.fc_recv_usage + fcDelta) + " > advertised " + context.local_max_data);
        close(3, "connection flow control exceeded");
        return;
      }
      stream.max_recv_offset = newHigh;
      context.fc_recv_usage += fcDelta;
    }
    var alreadyHave = false;
    for (var ri = 0; ri < stream.ranges.length; ri += 2) {
      if (frame.offset >= stream.ranges[ri] && frame.offset + frame.data.length <= stream.ranges[ri + 1]) {
        alreadyHave = true;
        break;
      }
    }
    if (!alreadyHave) {
      flat_ranges_default.add(stream.ranges, [frame.offset, frame.offset + frame.data.length]);
      if (!(frame.offset in stream.chunks) || stream.chunks[frame.offset].byteLength < frame.data.byteLength) {
        stream.chunks[frame.offset] = frame.data;
      }
      context.bytes_received += frame.data.byteLength;
    }
    if (frame.fin && stream.total_size === 0) stream.total_size = frame.offset + frame.data.length;
    flushStream(sid);
  }
  function flushStream(sid) {
    var stream = context.recv_streams[sid];
    if (!stream) return;
    var parts = [];
    var offset = stream.flushed_to;
    while (true) {
      var chunk = stream.chunks[offset];
      var chunkStart = offset;
      if (!chunk) {
        var keys = Object.keys(stream.chunks);
        for (var ki = 0; ki < keys.length; ki++) {
          var ks = Number(keys[ki]);
          var c = stream.chunks[ks];
          var kEnd = ks + c.byteLength;
          if (kEnd <= offset) {
            delete stream.chunks[ks];
            continue;
          }
          if (ks < offset && kEnd > offset) {
            chunk = c;
            chunkStart = ks;
            break;
          }
        }
        if (!chunk) break;
      }
      delete stream.chunks[chunkStart];
      var skip = offset - chunkStart;
      parts.push(skip > 0 ? chunk.subarray(skip) : chunk);
      offset = chunkStart + chunk.byteLength;
    }
    if (parts.length === 0) {
      if (stream.total_size > 0 && offset >= stream.total_size && !stream.fin_emitted) {
        stream.fin_emitted = true;
        ev.emit("stream", Number(sid), new Uint8Array(0), true);
        setTimeout(function() {
          delete context.recv_streams[sid];
        }, 100);
      }
      return;
    }
    var delivered = offset - stream.flushed_to;
    stream.flushed_to = offset;
    var data = parts.length === 1 ? parts[0] : concatUint8Arrays(parts);
    var fin = stream.total_size > 0 && offset >= stream.total_size;
    if (fin) stream.fin_emitted = true;
    ev.emit("stream", Number(sid), data, fin);
    if (fin) setTimeout(function() {
      delete context.recv_streams[sid];
    }, 100);
    context.local_max_data_consumed += delivered;
    var W = context.local_max_data_window;
    if (context.local_max_data_consumed + W - context.local_max_data >= W / 2) {
      context.local_max_data = context.local_max_data_consumed + W;
      sendFrames("app", [{ type: "max_data", max: context.local_max_data }]);
    }
    if (!fin) {
      var Ws = context.local_initial_max_stream_data;
      if (stream.flushed_to + Ws - stream.local_max_stream_data >= Ws / 2) {
        stream.local_max_stream_data = stream.flushed_to + Ws;
        sendFrames("app", [{ type: "max_stream_data", id: Number(sid), max: stream.local_max_stream_data }]);
      }
    }
  }
  function updateRtt(latest_rtt, ack_delay_ms) {
    context.latest_rtt = latest_rtt;
    context.min_rtt = context.min_rtt === null ? latest_rtt : Math.min(context.min_rtt, latest_rtt);
    context.max_rtt = context.max_rtt === null ? latest_rtt : Math.max(context.max_rtt, latest_rtt);
    var BBR_MIN_RTT_WINDOW = 1e4;
    var now_rtt = Date.now();
    if (context.bbr_min_rtt === null || latest_rtt <= context.bbr_min_rtt || now_rtt - context.bbr_min_rtt_stamp > BBR_MIN_RTT_WINDOW) {
      context.bbr_min_rtt = latest_rtt;
      context.bbr_min_rtt_stamp = now_rtt;
    }
    var ack_delay = Math.min(ack_delay_ms, context.max_ack_delay);
    var adjusted = latest_rtt;
    if (latest_rtt >= context.min_rtt + ack_delay) adjusted = latest_rtt - ack_delay;
    if (context.srtt === null) {
      context.srtt = adjusted;
      context.rttvar = adjusted / 2;
    } else {
      context.rttvar = 0.75 * context.rttvar + 0.25 * Math.abs(context.srtt - adjusted);
      context.srtt = 0.875 * context.srtt + 0.125 * adjusted;
    }
    if (DEBUG) console.log("[quic] rtt: sample=" + latest_rtt + "ms srtt=" + Math.round(context.srtt) + " rttvar=" + Math.round(context.rttvar) + " min=" + context.min_rtt);
  }
  function appBytesInFlight() {
    var total = 0;
    for (var sid in context.send_streams) {
      var st = context.send_streams[sid];
      if (!st.in_flight_ranges) continue;
      for (var pn in st.in_flight_ranges) {
        if (pn === "_burst") continue;
        total += st.in_flight_ranges[pn][1] - st.in_flight_ranges[pn][0];
      }
    }
    return total;
  }
  function processAckFrame(space, frame) {
    var ackedRanges = ack_frame_to_ranges(frame);
    if (!ackedRanges || ackedRanges.length === 0) return;
    var ackNow = Date.now();
    var prevAckTime = context.last_ack_time;
    context.last_ack_time = ackNow;
    if (space === "initial" || space === "handshake") {
      var cs = context.crypto_sent[space];
      for (var cpn in cs.in_flight) {
        var p = Number(cpn), hit = false;
        for (var cri = 0; cri < ackedRanges.length; cri += 2) {
          if (p >= ackedRanges[cri] && p <= ackedRanges[cri + 1]) {
            hit = true;
            break;
          }
        }
        if (hit) {
          flat_ranges_default.add(cs.acked, cs.in_flight[cpn].range);
          delete cs.in_flight[cpn];
        }
      }
      cs.backoff = 0;
      return;
    }
    if (space === "app") {
      let ackedOverlap = function(flat, from, to) {
        var ov = 0;
        for (var oi = 0; oi < flat.length; oi += 2) {
          if (flat[oi] >= to) break;
          var a = Math.max(from, flat[oi]), b = Math.min(to, flat[oi + 1]);
          if (b > a) ov += b - a;
        }
        return ov;
      }, creditSpan = function(st2, from, to) {
        var fresh = to - from - ackedOverlap(st2.acked_ranges, from, to);
        flat_ranges_default.add(st2.acked_ranges, [from, to]);
        return fresh > 0 ? fresh : 0;
      }, retireStreamIfComplete = function(sid2, st2) {
        if (st2.total_size > 0 && st2.acked_ranges.length === 2 && st2.acked_ranges[0] === 0 && st2.acked_ranges[1] >= st2.total_size) {
          delete context.send_streams[sid2];
          delete context.remote_max_stream_data_by_sid[sid2];
          delete context.last_stream_blocked_sent[sid2];
        }
      };
      if ("largest" in frame && "delay" in frame) {
        var largest_pn = frame.largest;
        if (context.sending_app_pn_in_flight.has(largest_pn) || largest_pn in context.expired_unacked) {
          var now = Date.now();
          var ack_delay_ms = Math.round(frame.delay * Math.pow(2, context.peer_ack_delay_exponent) / 1e3);
          var pn_index = largest_pn - (context.send_pn.app - context.sending_app_pn_history.length);
          if (pn_index >= 0 && pn_index < context.sending_app_pn_history.length) {
            var latest_rtt = now - context.sending_app_pn_history[pn_index][0];
            if (latest_rtt > 0) updateRtt(latest_rtt, ack_delay_ms);
          }
        }
      }
      var ackedPns = [];
      for (var pn of context.sending_app_pn_in_flight) {
        for (var ri = 0; ri < ackedRanges.length; ri += 2) {
          if (pn >= ackedRanges[ri] && pn <= ackedRanges[ri + 1]) {
            ackedPns.push(pn);
            break;
          }
        }
      }
      var newlyAckedBytes = 0;
      var oldestAckedPn = null;
      for (var ai = 0; ai < ackedPns.length; ai++) {
        var apn = ackedPns[ai];
        if (oldestAckedPn === null || apn < oldestAckedPn) oldestAckedPn = apn;
        context.sending_app_pn_in_flight.delete(apn);
        for (var sid in context.send_streams) {
          var st = context.send_streams[sid];
          if (st.in_flight_ranges && apn in st.in_flight_ranges) {
            newlyAckedBytes += creditSpan(st, st.in_flight_ranges[apn][0], st.in_flight_ranges[apn][1]);
            delete st.in_flight_ranges[apn];
            retireStreamIfComplete(sid, st);
          }
        }
      }
      for (var lpn in context.expired_unacked) {
        var lnum = Number(lpn);
        var hit = false;
        for (var ri2 = 0; ri2 < ackedRanges.length; ri2 += 2) {
          if (lnum >= ackedRanges[ri2] && lnum <= ackedRanges[ri2 + 1]) {
            hit = true;
            break;
          }
        }
        if (!hit) continue;
        var rec = context.expired_unacked[lpn];
        for (var si2 = 0; si2 < rec.spans.length; si2++) {
          var sidL = rec.spans[si2][0];
          var stL = context.send_streams[sidL];
          if (!stL) continue;
          newlyAckedBytes += creditSpan(stL, rec.spans[si2][1], rec.spans[si2][2]);
          retireStreamIfComplete(sidL, stL);
        }
        delete context.expired_unacked[lpn];
        if (context.lost_count > 0) context.lost_count--;
      }
      context.delivered += newlyAckedBytes;
      if (oldestAckedPn !== null && context.sending_app_pn_history.length > 0) {
        var rs_idx = oldestAckedPn - (context.send_pn.app - context.sending_app_pn_history.length);
        if (rs_idx >= 0 && rs_idx < context.sending_app_pn_history.length) {
          var deliveredAtSend = context.sending_app_pn_history[rs_idx][2];
          var deliveredTimeAtSend = context.sending_app_pn_history[rs_idx][3];
          var interval = ackNow - deliveredTimeAtSend;
          var deltaDelivered = context.delivered - deliveredAtSend;
          if (interval >= 1 && deltaDelivered > 0) {
            context.latest_delivery_rate = deltaDelivered * 1e3 / interval;
            if (context.max_delivery_rate === null || context.latest_delivery_rate > context.max_delivery_rate) {
              context.max_delivery_rate = context.latest_delivery_rate;
            }
          }
        }
      }
      context.delivered_time = ackNow;
      if ("largest" in frame && frame.largest >= context.bbr_round_start_pn) {
        var roundDur = ackNow - context.bbr_round_start_time;
        var roundDelivered = context.delivered - context.bbr_round_start_delivered;
        if (roundDur >= 1 && roundDelivered > 0) {
          context.bbr_btlbw_samples.push({ round: context.bbr_round_count, rate: roundDelivered * 1e3 / roundDur });
        }
        context.bbr_round_count++;
        context.bbr_round_start_pn = context.send_pn.app;
        context.bbr_round_start_delivered = context.delivered;
        context.bbr_round_start_time = ackNow;
        var BBR_BTLBW_WINDOW = 10;
        var cutoff = context.bbr_round_count - BBR_BTLBW_WINDOW;
        var kept = [], maxRate = null;
        for (var bi = 0; bi < context.bbr_btlbw_samples.length; bi++) {
          var smp = context.bbr_btlbw_samples[bi];
          if (smp.round >= cutoff) {
            kept.push(smp);
            if (maxRate === null || smp.rate > maxRate) maxRate = smp.rate;
          }
        }
        context.bbr_btlbw_samples = kept;
        context.bbr_btlbw = maxRate;
        if (context.bbr_btlbw !== null && context.bbr_min_rtt !== null) {
          var BBR_RTPROP_FLOOR_MS = 5;
          var rttForBdp = Math.max(context.bbr_min_rtt, BBR_RTPROP_FLOOR_MS);
          context.bbr_bdp = context.bbr_btlbw * (rttForBdp / 1e3);
          var STARTUP_GAIN = 2.89;
          var pacing_gain, cwnd_gain;
          if (context.bbr_state === "startup") {
            pacing_gain = STARTUP_GAIN;
            cwnd_gain = STARTUP_GAIN;
            if (context.bbr_btlbw >= context.bbr_full_bw * 1.25) {
              context.bbr_full_bw = context.bbr_btlbw;
              context.bbr_full_bw_count = 0;
            } else if (++context.bbr_full_bw_count >= 3) {
              context.bbr_state = "drain";
            }
          } else if (context.bbr_state === "drain") {
            pacing_gain = 1 / STARTUP_GAIN;
            cwnd_gain = STARTUP_GAIN;
            if (appBytesInFlight() <= context.bbr_bdp) context.bbr_state = "probe_bw";
          } else {
            var PROBE_BW_CYCLE = [1.25, 0.75, 1, 1, 1, 1, 1, 1];
            pacing_gain = PROBE_BW_CYCLE[context.bbr_cycle_idx];
            cwnd_gain = 1.25;
            context.bbr_cycle_idx = (context.bbr_cycle_idx + 1) % PROBE_BW_CYCLE.length;
          }
          var clamp = function(v, lo, hi) {
            return Math.max(lo, Math.min(hi, v));
          };
          var targetInflight = clamp(
            cwnd_gain * context.bbr_bdp,
            context.min_limit_bytes_in_flight,
            context.max_limit_bytes_in_flight
          );
          context.current_limit_bytes_in_flight = targetInflight;
          context.current_limit_packets_in_flight = clamp(
            Math.round(targetInflight / context.current_limit_packet_payload),
            context.min_limit_packets_in_flight,
            context.max_limit_packets_in_flight
          );
          var targetRate = clamp(
            pacing_gain * context.bbr_btlbw,
            context.min_limit_bytes_per_sec,
            context.max_limit_bytes_per_sec
          );
          context.current_limit_bytes_per_sec = targetRate;
          context.current_limit_packets_per_sec = clamp(
            Math.round(targetRate / context.current_limit_packet_payload),
            1,
            context.max_limit_packets_per_sec
          );
        }
        if (DEBUG_BBR && context.bbr_bdp !== null) {
          console.log("[bbr] round=" + context.bbr_round_count + " " + context.bbr_state + " BtlBw=" + (context.bbr_btlbw * 8 / 1e6).toFixed(2) + "Mbps RTprop=" + context.bbr_min_rtt + "ms BDP=" + Math.round(context.bbr_bdp) + "B \u2192 cwnd=" + Math.round(context.current_limit_bytes_in_flight) + "B pace=" + (context.current_limit_bytes_per_sec * 8 / 1e6).toFixed(2) + "Mbps");
        }
      }
      plan_quic_burst();
    }
  }
  function cryptoWrite(epoch, data) {
    var space = epoch === "initial" ? "initial" : epoch === "handshake" ? "handshake" : "app";
    var offset = context.crypto_send_offset[space];
    context.crypto_send_offset[space] += data.byteLength;
    if (space === "initial" || space === "handshake") {
      context.crypto_sent[space].buf.push({ off: offset, data });
    }
    sendFrames(space, [{ type: "crypto", offset, data }]);
    if (space === "initial" || space === "handshake") scheduleCryptoRetx();
  }
  function cryptoSlice(space, from, to) {
    var out = new Uint8Array(to - from);
    var frags = context.crypto_sent[space].buf;
    for (var i = 0; i < frags.length; i++) {
      var fOff = frags[i].off, fEnd = fOff + frags[i].data.byteLength;
      var lo = Math.max(from, fOff), hi = Math.min(to, fEnd);
      if (lo < hi) out.set(frags[i].data.subarray(lo - fOff, hi - fOff), lo - from);
    }
    return out;
  }
  function cryptoTimeout(space) {
    var base = context.srtt === null ? 333 : context.srtt + Math.max(4 * context.rttvar, 1);
    var bo = Math.min(context.crypto_sent[space].backoff, 6);
    return base * Math.pow(2, bo);
  }
  function resendMissingCrypto(space) {
    var cs = context.crypto_sent[space];
    var total = context.crypto_send_offset[space];
    if (total === 0) return false;
    var known = cs.acked.slice();
    for (var pn in cs.in_flight) flat_ranges_default.add(known, cs.in_flight[pn].range);
    var missing = flat_ranges_default.invert(known, 0, total);
    if (!missing || missing.length === 0) return false;
    var MAX = Math.max(256, context.current_limit_packet_payload - 64);
    var sentAny = false;
    for (var i = 0; i < missing.length; i += 2) {
      var from = missing[i], to = missing[i + 1];
      while (from < to) {
        var end = Math.min(from + MAX, to);
        sendFrames(space, [{ type: "crypto", offset: from, data: cryptoSlice(space, from, end) }]);
        sentAny = true;
        from = end;
      }
    }
    return sentAny;
  }
  function expireCryptoInFlight() {
    var now = Date.now(), spaces = ["initial", "handshake"], expired = false;
    for (var s = 0; s < spaces.length; s++) {
      var space = spaces[s], cs = context.crypto_sent[space], timeout = cryptoTimeout(space);
      for (var pn in cs.in_flight) {
        if (now - cs.in_flight[pn].time_sent >= timeout) {
          delete cs.in_flight[pn];
          expired = true;
        }
      }
    }
    return expired;
  }
  function cryptoHasInFlight() {
    return Object.keys(context.crypto_sent.initial.in_flight).length > 0 || Object.keys(context.crypto_sent.handshake.in_flight).length > 0;
  }
  function cryptoTick() {
    context.crypto_timer = null;
    if (expireCryptoInFlight()) {
      if (resendMissingCrypto("initial")) context.crypto_sent.initial.backoff++;
      if (resendMissingCrypto("handshake")) context.crypto_sent.handshake.backoff++;
    }
    if (cryptoHasInFlight()) scheduleCryptoRetx();
  }
  function scheduleCryptoRetx() {
    if (context.crypto_timer !== null) return;
    var iv = Math.min(cryptoTimeout("initial"), cryptoTimeout("handshake"));
    context.crypto_timer = setTimeout(cryptoTick, iv);
    if (context.crypto_timer.unref) context.crypto_timer.unref();
  }
  function stopCryptoRetx() {
    if (context.crypto_timer !== null) {
      clearTimeout(context.crypto_timer);
      context.crypto_timer = null;
    }
    context.crypto_sent.initial = { buf: [], in_flight: {}, acked: [], backoff: 0 };
    context.crypto_sent.handshake = { buf: [], in_flight: {}, acked: [], backoff: 0 };
  }
  function sendFrames(space, frameList) {
    if (context.state === "draining" || context.state === "closed") return;
    if (context.state === "closing" && !(frameList.length === 1 && frameList[0].type === "connection_close")) return;
    var writeKeys = space === "initial" ? context.initial_write : space === "handshake" ? context.handshake_write : context.app_write;
    if (!writeKeys) {
      if (DEBUG) console.log("[quic] sendFrames(" + space + ") \u2014 no keys");
      return;
    }
    var pn = context.send_pn[space];
    var packetType = space === "initial" ? "initial" : space === "handshake" ? "handshake" : "1rtt";
    var dcid, scid;
    if (packetType === "1rtt") {
      dcid = context.their_cids.length > 0 ? context.their_cids[0] : new Uint8Array(0);
      scid = new Uint8Array(0);
    } else if (context.isServer) {
      dcid = context.their_cids.length > 0 ? context.their_cids[0] : new Uint8Array(0);
      scid = context.original_dcid || new Uint8Array(0);
    } else {
      if (space === "initial" || context.their_cids.length === 0) {
        dcid = context.original_dcid || new Uint8Array(0);
      } else {
        dcid = context.their_cids[0];
      }
      scid = context.my_cids.length > 0 ? context.my_cids[0] : new Uint8Array(0);
    }
    var encoded = encode_quic_frames(frameList);
    if (space === "initial") {
      var overhead = 1 + 4 + 1 + dcid.byteLength + 1 + scid.byteLength + 1 + 2 + 1 + 16;
      var minPayload = 1200 - overhead;
      if (encoded.length < minPayload) {
        encoded = concatUint8Arrays([encoded, new Uint8Array(minPayload - encoded.length)]);
      }
    }
    var encrypted = encrypt_quic_packet(
      packetType,
      encoded,
      writeKeys.key,
      writeKeys.iv,
      writeKeys.hp,
      pn,
      dcid,
      scid,
      null,
      space === "app" ? context.key_phase : false
    );
    if (encrypted) {
      context.send_pn[space] = pn + 1;
      var fnames = frameList.map(function(f) {
        return f.type + (f.type === "ack" ? "(lg=" + f.largest + ")" : "");
      }).join(",");
      if (DEBUG) console.log("[quic] \u2192 " + packetType + " pn=" + pn + " frames=[" + fnames + "] len=" + encrypted.length);
      touchActivity();
      if (space === "app") {
        context.sending_app_pn_history.push([Date.now(), encoded.length, context.delivered, context.delivered_time]);
        var has_data = false;
        for (var i = 0; i < frameList.length; i++) {
          if (frameList[i].type === "stream" || frameList[i].type === "crypto") {
            has_data = true;
            break;
          }
        }
        if (has_data) context.sending_app_pn_in_flight.add(pn);
        for (var i = 0; i < frameList.length; i++) {
          if (frameList[i].type === "stream") {
            var sid = frameList[i].id;
            var dataLen = frameList[i].data ? frameList[i].data.byteLength : 0;
            context.bytes_sent += dataLen;
            if (sid in context.send_streams) {
              if (!context.send_streams[sid].in_flight_ranges) context.send_streams[sid].in_flight_ranges = {};
              var from = frameList[i].offset;
              var to = from + (frameList[i].data ? frameList[i].data.byteLength : 0);
              if (!context.send_streams[sid].in_flight_ranges[pn]) {
                context.send_streams[sid].in_flight_ranges[pn] = [from, to];
              } else {
                flat_ranges_default.add(context.send_streams[sid].in_flight_ranges[pn], [from, to]);
              }
            }
          }
        }
      }
      if (space === "initial" || space === "handshake") {
        for (var ci = 0; ci < frameList.length; ci++) {
          if (frameList[ci].type === "crypto") {
            var cFrom = frameList[ci].offset;
            var cTo = cFrom + (frameList[ci].data ? frameList[ci].data.byteLength : 0);
            if (cTo > cFrom) context.crypto_sent[space].in_flight[pn] = { range: [cFrom, cTo], time_sent: Date.now() };
          }
        }
      }
      ev.emit("packet", encrypted);
    }
  }
  function initialStreamSendLimit(sid) {
    var isUni = (sid & 2) === 2;
    var clientInitiated = (sid & 1) === 0;
    var weInitiated = context.isServer ? !clientInitiated : clientInitiated;
    var base;
    if (isUni) base = context.peer_initial_max_stream_data_uni;
    else if (weInitiated) base = context.peer_initial_max_stream_data_bidi_remote;
    else base = context.peer_initial_max_stream_data_bidi_local;
    var pending = context.remote_max_stream_data_by_sid[sid] || 0;
    return Math.max(base, pending);
  }
  function set_sending_stream(streamId, options2) {
    if (!(streamId in context.send_streams)) {
      context.send_streams[streamId] = {
        pending_data: null,
        pending_offset_start: 0,
        write_offset: 0,
        send_offset: 0,
        total_size: 0,
        fin_sent: false,
        acked_ranges: [],
        in_flight_ranges: {},
        // Send-side FC (RFC 9000 §4.1): the peer's absolute offset cap for
        // this stream, and our high-water mark (highest offset ever yielded).
        // New data = bytes extending max_sent_offset; only those consume the
        // connection-level budget. See get_stream_chunks.
        remote_max_stream_data: initialStreamSendLimit(streamId),
        max_sent_offset: 0,
        fc_blocked: false
      };
    }
    var stream = context.send_streams[streamId];
    if (typeof options2 === "object" && "add_chunk" in options2) {
      if (options2.add_chunk.data === null || options2.add_chunk.data === void 0) {
        if (stream.total_size === 0) {
          stream.total_size = stream.write_offset;
          if (DEBUG) console.log("[quic] stream " + streamId + " FIN via null data, total_size=" + stream.total_size);
        }
      } else {
        var chunk = options2.add_chunk.data;
        if (typeof chunk === "string") chunk = new TextEncoder().encode(chunk);
        var start = stream.write_offset;
        stream.write_offset += chunk.byteLength;
        if (DEBUG) console.log("[quic] stream " + streamId + " add_chunk len=" + chunk.byteLength + " write_offset=" + stream.write_offset + " fin=" + !!options2.add_chunk.fin);
        if (stream.pending_data === null) {
          stream.pending_data = chunk;
          stream.pending_offset_start = start;
        } else {
          var old = stream.pending_data, old_off = stream.pending_offset_start;
          var ns = Math.min(old_off, start);
          var ne = Math.max(old_off + old.length, start + chunk.length);
          var merged = new Uint8Array(ne - ns);
          merged.set(old, old_off - ns);
          merged.set(chunk, start - ns);
          stream.pending_data = merged;
          stream.pending_offset_start = ns;
        }
        if (options2.add_chunk.fin) {
          stream.total_size = stream.write_offset;
          if (DEBUG) console.log("[quic] stream " + streamId + " FIN via add_chunk.fin, total_size=" + stream.total_size);
        }
      }
    }
    plan_quic_burst();
  }
  function sendStream(streamId, data, fin) {
    set_sending_stream(streamId, { add_chunk: { data, fin } });
  }
  function sendDatagram(data) {
    if (context.state !== "connected") return false;
    if (typeof data === "string") data = new TextEncoder().encode(data);
    if (data.byteLength > context.current_limit_packet_payload - 1) {
      if (DEBUG) console.log("[quic] sendDatagram: payload too large (" + data.byteLength + " > " + (context.current_limit_packet_payload - 1) + ")");
      return false;
    }
    sendFrames("app", [{ type: "datagram", data }]);
    return true;
  }
  function maxDatagramSize() {
    if (context.state !== "connected") return 0;
    return Math.max(0, context.current_limit_packet_payload - 1);
  }
  function expireInFlight() {
    var now = Date.now();
    var base = context.srtt === null ? 333 : context.srtt + Math.max(4 * context.rttvar, 1) + context.max_ack_delay;
    var sinceAck = now - context.last_ack_time;
    var mult = 1;
    while (sinceAck > base * mult * 2 && mult < 1024) mult *= 2;
    var timeout = base * mult;
    var pnBase = context.send_pn.app - context.sending_app_pn_history.length;
    for (var sid in context.send_streams) {
      var st = context.send_streams[sid];
      if (!st.in_flight_ranges) continue;
      for (var pn in st.in_flight_ranges) {
        if (pn === "_burst") continue;
        var pnum = Number(pn);
        var idx = pnum - pnBase;
        var expired;
        if (idx < 0 || idx >= context.sending_app_pn_history.length) {
          expired = true;
        } else {
          expired = now - context.sending_app_pn_history[idx][0] >= timeout;
        }
        if (expired) {
          var limbo = context.expired_unacked[pnum];
          if (!limbo) limbo = context.expired_unacked[pnum] = { t: now, spans: [] };
          limbo.spans.push([sid, st.in_flight_ranges[pn][0], st.in_flight_ranges[pn][1]]);
          delete st.in_flight_ranges[pn];
          if (context.sending_app_pn_in_flight.delete(pnum)) context.lost_count++;
        }
      }
    }
    var limboCutoff = now - Math.max(1e4, timeout * 8);
    for (var lpn in context.expired_unacked) {
      if (context.expired_unacked[lpn].t < limboCutoff) delete context.expired_unacked[lpn];
    }
  }
  var FC_BLOCKED_RESEND_MS = 500;
  function maybeSendBlockedFrames() {
    var now = Date.now();
    var wasBlocked = false;
    if (context.fc_blocked_conn) {
      context.fc_blocked_conn = false;
      wasBlocked = true;
      if (now - context.last_data_blocked_sent >= FC_BLOCKED_RESEND_MS) {
        context.last_data_blocked_sent = now;
        sendFrames("app", [{ type: "data_blocked", limit: context.remote_max_data }]);
      }
    }
    for (var sid in context.send_streams) {
      var st = context.send_streams[sid];
      if (!st.fc_blocked) continue;
      st.fc_blocked = false;
      wasBlocked = true;
      if (now - (context.last_stream_blocked_sent[sid] || 0) >= FC_BLOCKED_RESEND_MS) {
        context.last_stream_blocked_sent[sid] = now;
        sendFrames("app", [{ type: "stream_data_blocked", id: Number(sid), limit: st.remote_max_stream_data }]);
      }
    }
    return wasBlocked;
  }
  function plan_quic_burst() {
    if (!context.app_write) return;
    if (context.state !== "connected") return;
    if (context.burst_timer !== null) {
      clearTimeout(context.burst_timer);
      clearImmediate(context.burst_timer);
      context.burst_timer = null;
    }
    expireInFlight();
    var now = Date.now();
    var oneSecAgo = now - 1e3;
    var bytesSentLastSec = 0;
    var packetsSentLastSec = 0;
    for (var i = 0; i < context.sending_app_pn_history.length; i++) {
      if (context.sending_app_pn_history[i][0] > oneSecAgo) {
        bytesSentLastSec += context.sending_app_pn_history[i][1];
        packetsSentLastSec++;
      }
    }
    var twoSecAgo = now - 2e3;
    while (context.sending_app_pn_history.length > 0 && context.sending_app_pn_history[0][0] < twoSecAgo) {
      context.sending_app_pn_history.shift();
    }
    var effBytesPerSec = Math.min(context.current_limit_bytes_per_sec, context.max_limit_bytes_per_sec);
    var effPacketsPerSec = Math.min(context.current_limit_packets_per_sec, context.max_limit_packets_per_sec);
    var effPktsInFlight = Math.min(context.max_limit_packets_in_flight, Math.max(context.min_limit_packets_in_flight, context.current_limit_packets_in_flight));
    var effBytesInFlight = Math.min(context.max_limit_bytes_in_flight, Math.max(context.min_limit_bytes_in_flight, context.current_limit_bytes_in_flight));
    var bytesRemaining = effBytesPerSec - bytesSentLastSec;
    var packetsRemaining = effPacketsPerSec - packetsSentLastSec;
    if (bytesRemaining < 0) bytesRemaining = 0;
    if (packetsRemaining < 0) packetsRemaining = 0;
    var inflightCount = context.sending_app_pn_in_flight.size;
    var inflightRoom = effPktsInFlight - inflightCount;
    if (inflightRoom < 0) inflightRoom = 0;
    var bytesInFlight = 0;
    for (var sidB in context.send_streams) {
      var stB = context.send_streams[sidB];
      if (!stB.in_flight_ranges) continue;
      for (var pnB in stB.in_flight_ranges) {
        if (pnB === "_burst") continue;
        bytesInFlight += stB.in_flight_ranges[pnB][1] - stB.in_flight_ranges[pnB][0];
      }
    }
    var bytesInFlightRoom = effBytesInFlight - bytesInFlight;
    if (bytesInFlightRoom < 0) bytesInFlightRoom = 0;
    var inflightBytesPackets = Math.floor(bytesInFlightRoom / context.current_limit_packet_payload);
    var burstCount = Math.min(
      context.max_packets_per_burst,
      packetsRemaining,
      inflightRoom,
      inflightBytesPackets,
      // bytes-in-flight cap
      Math.floor(bytesRemaining / Math.max(1, 35))
      // min packet ~35 bytes
    );
    if (burstCount < 0) burstCount = 0;
    var PACE_BURST_MS = 5;
    var rateBps = context.current_limit_bytes_per_sec;
    var nowR = Date.now();
    context.pacing_tokens += (nowR - context.pacing_last_refill) / 1e3 * rateBps;
    context.pacing_last_refill = nowR;
    var tokenCap = Math.max(2 * context.current_limit_packet_payload, rateBps * (PACE_BURST_MS / 1e3));
    if (context.pacing_tokens > tokenCap) context.pacing_tokens = tokenCap;
    var tokenPackets = Math.floor(context.pacing_tokens / context.current_limit_packet_payload);
    if (burstCount > tokenPackets) burstCount = tokenPackets;
    var hasData = false;
    for (var sid in context.send_streams) {
      var st = context.send_streams[sid];
      if (!st.pending_data || st.pending_data.byteLength === 0) continue;
      var total = st.total_size > 0 ? st.total_size : st.write_offset;
      var known = st.acked_ranges.slice();
      if (st.in_flight_ranges) {
        for (var pn in st.in_flight_ranges) flat_ranges_default.add(known, st.in_flight_ranges[pn]);
      }
      var missing = flat_ranges_default.invert(known, 0, total);
      if (missing.length > 0) {
        hasData = true;
        break;
      }
      if (st.total_size > 0 && !st.fin_sent && missing.length === 0) {
        hasData = true;
        break;
      }
    }
    var hasPendingAck = context.pending_ack.app.length > 0;
    var hasInFlight = false;
    for (var sidF in context.send_streams) {
      var stF = context.send_streams[sidF];
      if (!stF.in_flight_ranges) continue;
      for (var pnF in stF.in_flight_ranges) {
        if (pnF !== "_burst") {
          hasInFlight = true;
          break;
        }
      }
      if (hasInFlight) break;
    }
    if (!hasData && !hasPendingAck && !hasInFlight) return;
    var pacedOut = hasData && burstCount === 0 && tokenPackets < 1 && context.sending_app_pn_in_flight.size < effPktsInFlight;
    var sent = 0;
    if (burstCount > 0) {
      sent = execute_quic_burst(burstCount);
      if (sent > 0) context.pacing_tokens -= sent * context.current_limit_packet_payload;
    }
    var fcBlocked = maybeSendBlockedFrames();
    if (hasData && (sent || pacedOut)) {
      var delayMs = rateBps > 0 ? context.current_limit_packet_payload * 1e3 / rateBps : 1;
      if (delayMs < 1) delayMs = 1;
      if (delayMs > 100) delayMs = 100;
      context.burst_timer = setTimeout(function() {
        context.burst_timer = null;
        plan_quic_burst();
      }, delayMs);
      if (context.burst_timer.unref) context.burst_timer.unref();
    } else if (burstCount === 0 && hasData) {
      var waitMs = packetsRemaining <= 0 || bytesRemaining < 35 ? 50 : 10;
      context.burst_timer = setTimeout(function() {
        context.burst_timer = null;
        plan_quic_burst();
      }, waitMs);
      if (context.burst_timer.unref) context.burst_timer.unref();
    } else if (hasInFlight) {
      context.burst_timer = setTimeout(function() {
        context.burst_timer = null;
        plan_quic_burst();
      }, 20);
      if (context.burst_timer.unref) context.burst_timer.unref();
    } else if (fcBlocked && hasData) {
      context.burst_timer = setTimeout(function() {
        context.burst_timer = null;
        plan_quic_burst();
      }, 250);
      if (context.burst_timer.unref) context.burst_timer.unref();
    }
  }
  function execute_quic_burst(packetCount) {
    var MAX_PAYLOAD = context.current_limit_packet_payload;
    var OVERHEAD = 24;
    var sentCount = 0;
    function getActiveIds() {
      var ids = [];
      for (var sid2 in context.send_streams) {
        var st2 = context.send_streams[sid2];
        if (!st2.pending_data || st2.pending_data.byteLength === 0) continue;
        var total = st2.total_size > 0 ? st2.total_size : st2.write_offset;
        var known2 = st2.acked_ranges.slice();
        if (st2.in_flight_ranges) {
          for (var pn2 in st2.in_flight_ranges) flat_ranges_default.add(known2, st2.in_flight_ranges[pn2]);
        }
        var missing2 = flat_ranges_default.invert(known2, 0, total);
        if (missing2.length > 0) ids.push(Number(sid2));
      }
      return ids;
    }
    var activeIds = getActiveIds();
    var burstYielded = {};
    for (var p = 0; p < packetCount; p++) {
      var frames = [];
      var used = 0;
      if (p === 0 && context.pending_ack.app.length > 0) {
        var ackFrame = ranges_to_ack_frame(context.pending_ack.app, null, 0);
        if (ackFrame) {
          var ackEncoded = encode_quic_frames([ackFrame]);
          if (ackEncoded.byteLength <= MAX_PAYLOAD) {
            frames.push(ackFrame);
            used += ackEncoded.byteLength;
            context.pending_ack.app = [];
          }
        }
      }
      if (activeIds.length > 0 && used < MAX_PAYLOAD) {
        var progress = true;
        while (used < MAX_PAYLOAD && progress) {
          progress = false;
          for (var i = 0; i < activeIds.length; i++) {
            if (used >= MAX_PAYLOAD) break;
            var sid = activeIds[i];
            var st = context.send_streams[sid];
            if (!st || !st.pending_data) continue;
            var budget = Math.max(0, MAX_PAYLOAD - used - OVERHEAD);
            if (budget <= 0) break;
            var chunks = get_stream_chunks(sid, budget);
            if (!chunks || chunks.length === 0) continue;
            for (var c = 0; c < chunks.length; c++) {
              var ch = chunks[c];
              var fin = st.total_size > 0 && ch.offset + ch.data.byteLength >= st.total_size;
              frames.push({ type: "stream", id: sid, offset: ch.offset, fin, data: ch.data });
              used += ch.data.byteLength + OVERHEAD;
              progress = true;
              if (!burstYielded[sid]) burstYielded[sid] = [];
              flat_ranges_default.add(burstYielded[sid], [ch.offset, ch.offset + ch.data.byteLength]);
              if (!st.in_flight_ranges) st.in_flight_ranges = {};
              if (!st.in_flight_ranges["_burst"]) st.in_flight_ranges["_burst"] = [];
              flat_ranges_default.add(st.in_flight_ranges["_burst"], [ch.offset, ch.offset + ch.data.byteLength]);
            }
          }
        }
      }
      for (var sid in context.send_streams) {
        var st = context.send_streams[sid];
        if (!st || st.total_size <= 0 || st.fin_sent) continue;
        var known = st.acked_ranges.slice();
        if (st.in_flight_ranges) {
          for (var pn in st.in_flight_ranges) flat_ranges_default.add(known, st.in_flight_ranges[pn]);
        }
        var missing = flat_ranges_default.invert(known, 0, st.total_size);
        if (DEBUG) console.log("[quic] FIN-only check stream=" + sid + " total_size=" + st.total_size + " fin_sent=" + st.fin_sent + " missing=" + missing.length + " known=" + JSON.stringify(known));
        if (missing.length === 0) {
          if (DEBUG) console.log("[quic] \u2192 sending FIN-only for stream " + sid);
          frames.push({ type: "stream", id: Number(sid), offset: st.total_size, fin: true, data: new Uint8Array(0) });
          st.fin_sent = true;
        }
      }
      if (frames.length > 0) {
        sendFrames("app", frames);
        sentCount++;
        for (var sid in burstYielded) {
          var st = context.send_streams[sid];
          if (st && st.in_flight_ranges && st.in_flight_ranges["_burst"]) {
            delete st.in_flight_ranges["_burst"];
          }
        }
      } else {
        break;
      }
      activeIds = getActiveIds();
      if (activeIds.length === 0) break;
    }
    return sentCount;
  }
  function get_stream_chunks(streamId, maxBytes) {
    var stream = context.send_streams[streamId];
    if (!stream || !stream.pending_data || stream.pending_data.byteLength === 0) return [];
    var streamLimit = stream.remote_max_stream_data;
    var connRemaining = context.remote_max_data - context.max_data_sent;
    var data = stream.pending_data;
    var baseOffset = stream.pending_offset_start;
    var totalSize = stream.total_size > 0 ? stream.total_size : stream.write_offset;
    var knownSent = stream.acked_ranges.slice();
    if (stream.in_flight_ranges) {
      for (var pn in stream.in_flight_ranges) {
        flat_ranges_default.add(knownSent, stream.in_flight_ranges[pn]);
      }
    }
    var missing = flat_ranges_default.invert(knownSent, 0, totalSize);
    if (!missing || missing.length === 0) return [];
    var sendOffset = stream.send_offset;
    var chunks = [];
    var used = 0;
    for (var i = 0; i < missing.length; i += 2) {
      if (used >= maxBytes) break;
      var mFrom = missing[i];
      var mTo = missing[i + 1];
      if (mTo <= sendOffset) continue;
      var from = Math.max(mFrom, sendOffset);
      var to = mTo;
      var len = Math.min(to - from, maxBytes - used);
      if (len <= 0) continue;
      var relStart = from - baseOffset;
      var relEnd = relStart + len;
      if (relStart < 0 || relStart >= data.byteLength) continue;
      if (relEnd > data.byteLength) {
        relEnd = data.byteLength;
        len = relEnd - relStart;
      }
      if (len <= 0) continue;
      if (from + len > streamLimit) {
        stream.fc_blocked = true;
        if (from >= streamLimit) continue;
        len = streamLimit - from;
        relEnd = relStart + len;
      }
      var newStart = Math.max(from, stream.max_sent_offset);
      var newBytes = Math.max(0, from + len - newStart);
      if (newBytes > connRemaining) {
        context.fc_blocked_conn = true;
        len -= newBytes - connRemaining;
        relEnd = relStart + len;
        newBytes = connRemaining;
      }
      if (len <= 0) continue;
      chunks.push({ offset: from, data: data.slice(relStart, relEnd) });
      used += len;
      if (newBytes > 0) {
        stream.max_sent_offset = from + len;
        context.max_data_sent += newBytes;
        connRemaining -= newBytes;
      }
      if (from + len > stream.send_offset) {
        stream.send_offset = from + len;
      }
    }
    if (chunks.length > 0) {
      for (var ci = 0; ci < chunks.length; ci++) {
        flat_ranges_default.add(knownSent, [chunks[ci].offset, chunks[ci].offset + chunks[ci].data.byteLength]);
      }
      missing = flat_ranges_default.invert(knownSent, 0, totalSize);
    }
    if (used < maxBytes) {
      for (var i = 0; i < missing.length; i += 2) {
        if (used >= maxBytes) break;
        var mFrom = missing[i];
        var mTo = missing[i + 1];
        if (mFrom >= sendOffset) break;
        var to = Math.min(mTo, sendOffset);
        var len = Math.min(to - mFrom, maxBytes - used);
        if (len <= 0) continue;
        var relStart = mFrom - baseOffset;
        var relEnd = relStart + len;
        if (relStart < 0 || relStart >= data.byteLength) continue;
        if (relEnd > data.byteLength) {
          relEnd = data.byteLength;
          len = relEnd - relStart;
        }
        if (len <= 0) continue;
        if (mFrom >= streamLimit) continue;
        if (mFrom + len > streamLimit) {
          len = streamLimit - mFrom;
          relEnd = relStart + len;
        }
        var newStart2 = Math.max(mFrom, stream.max_sent_offset);
        var newBytes2 = Math.max(0, mFrom + len - newStart2);
        if (newBytes2 > connRemaining) {
          len -= newBytes2 - connRemaining;
          relEnd = relStart + len;
          newBytes2 = connRemaining;
        }
        if (len <= 0) continue;
        chunks.push({ offset: mFrom, data: data.slice(relStart, relEnd) });
        used += len;
        if (newBytes2 > 0) {
          stream.max_sent_offset = mFrom + len;
          context.max_data_sent += newBytes2;
          connRemaining -= newBytes2;
        }
      }
    }
    if (stream.acked_ranges.length >= 2 && stream.acked_ranges[0] === 0 && stream.acked_ranges[1] > baseOffset) {
      var trimTo = stream.acked_ranges[1];
      var trimBytes = trimTo - baseOffset;
      if (trimBytes > 0 && trimBytes < data.byteLength) {
        stream.pending_data = data.slice(trimBytes);
        stream.pending_offset_start = trimTo;
      }
    }
    return chunks;
  }
  function sendConnectionClose() {
    if (!context.close_frame) return;
    sendFrames("app", [context.close_frame]);
    context.last_close_echo = Date.now();
  }
  function close(errorCode, reason) {
    if (context.state === "closed" || context.state === "draining" || context.state === "closing") return;
    if (context.handshake_timer) {
      clearTimeout(context.handshake_timer);
      context.handshake_timer = null;
    }
    stopCryptoRetx();
    context.close_frame = {
      type: "connection_close",
      application: false,
      error: errorCode || 0,
      frameType: 0,
      reason: reason || ""
    };
    sendConnectionClose();
    set_context({ state: "closing" });
  }
  function connect2() {
    if (context.isServer) return;
    var dcid = new Uint8Array(8);
    for (var i = 0; i < 8; i++) dcid[i] = Math.floor(Math.random() * 256);
    var scid = new Uint8Array(8);
    for (var i = 0; i < 8; i++) scid[i] = Math.floor(Math.random() * 256);
    context.original_dcid = dcid;
    context.my_cids.push(scid);
    set_context({
      initial_write: quic_derive_init_secrets(dcid, context.version, "read"),
      initial_read: quic_derive_init_secrets(dcid, context.version, "write")
    });
    if (DEBUG) console.log("[quic] client connecting, dcid=" + Array.from(dcid).map(function(b) {
      return b.toString(16).padStart(2, "0");
    }).join(""));
    initTLS();
    tls.feedMessage(new Uint8Array(0));
  }
  var api = {
    context,
    on: function(name, fn) {
      ev.on(name, fn);
    },
    off: function(name, fn) {
      ev.off(name, fn);
    },
    feedDatagram,
    feedPackets,
    sendStream,
    sendDatagram,
    maxDatagramSize,
    close,
    connect: connect2,
    set_context,
    get state() {
      return context.state;
    }
  };
  for (var k in api) {
    if (Object.prototype.hasOwnProperty.call(api, k)) {
      Object.defineProperty(this, k, Object.getOwnPropertyDescriptor(api, k));
    }
  }
  return this;
}

// node_modules/quico/src/quic_socket.js
function createQuicClientSocket(opts) {
  var isIPv6 = opts.remoteIp.indexOf(":") >= 0;
  var udpSocket = empty_default.createSocket(isIPv6 ? "udp6" : "udp4");
  var quic = null;
  udpSocket.on("message", function(msg, rinfo) {
    if (quic) quic.feedDatagram(rinfo.address, rinfo.port, new Uint8Array(msg));
  });
  udpSocket.on("error", function(err) {
    if (opts.onError) opts.onError(err);
  });
  udpSocket.bind(0, function() {
    try {
      udpSocket.setSendBufferSize(2 * 1024 * 1024);
    } catch (e) {
    }
    try {
      udpSocket.setRecvBufferSize(2 * 1024 * 1024);
    } catch (e) {
    }
    quic = new QUICConnection({
      isServer: false,
      hostname: opts.hostname,
      // Without this the client always offered 'h3' regardless of what the
      // caller wanted, because TLSBridge falls back to ['h3'] when alpn is
      // undefined. Normalize a bare string into an array here so callers can
      // pass either form.
      alpn: (function() {
        var a = opts.alpn || ["h3"];
        return Array.isArray(a) ? a : [a];
      })(),
      // Defaults to true. Pass false for self-signed certificates, or supply
      // `ca` for a private CA.
      rejectUnauthorized: opts.rejectUnauthorized !== false,
      ca: opts.ca || null
    });
    if (opts.onSocket) opts.onSocket(quic, udpSocket);
    quic.on("packet", function(data) {
      udpSocket.send(data, opts.remotePort, opts.remoteIp, function(err) {
        if (err && opts.onError) opts.onError(err);
      });
    });
    quic.on("connect", function() {
      if (opts.onConnect) opts.onConnect(quic, udpSocket);
    });
    quic.on("close", function() {
      try {
        udpSocket.close();
      } catch (e) {
      }
      if (opts.onClose) opts.onClose();
    });
    quic.connect();
  });
  return udpSocket;
}
export {
  Emitter,
  QUICConnection,
  createQuicClientSocket
};
/*! Bundled license information:

@noble/ciphers/utils.js:
  (*! noble-ciphers - MIT License (c) 2023 Paul Miller (paulmillr.com) *)

@noble/curves/utils.js:
@noble/curves/abstract/modular.js:
@noble/curves/abstract/curve.js:
@noble/curves/abstract/edwards.js:
@noble/curves/abstract/montgomery.js:
@noble/curves/ed25519.js:
@noble/curves/abstract/der.js:
@noble/curves/abstract/weierstrass.js:
@noble/curves/nist.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
