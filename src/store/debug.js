const module = {
  actions: {
    /** Expose variables to window.atw for debugging. */
    debug(ctx, o) {
      if (!window.atw) {
        window.atw = {}
      }
      // eslint-disable-next-line fp/no-loops
      for (const key in o) {
        window.atw[key] = o[key]
      }
    },
  },
}

export default module
