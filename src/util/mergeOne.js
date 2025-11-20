/** Merges two or more objects, one level deep. One level deeper than { ...a, ...b }. */
const mergeOne = (...args) => {
  if (args.length > 2) {
    return mergeOne(args[0], mergeOne(...args.slice(1)))
  }

  const o = { ...args[0] }
  // eslint-disable-next-line fp/no-loops
  for (const key in args[1]) {
    o[key] = { ...args[0][key], ...args[1][key] }
  }
  return o
}

export default mergeOne
