/** Converts an array of strings to a written list of items separated by commas with a final " and ". */
const writtenList = arr =>
  arr.length === 0
    ? ''
    : arr.length === 1
    ? arr[0]
    : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]

export default writtenList
