/* A module that adds a listSorted getter to sort by sortOrder. Requires getters.list(). */
const module = () => ({
  getters: {
    listSorted: (state, getters) => () =>
      state.loaded
        ? // eslint-disable-next-line fp/no-mutating-methods
          getters
            .list()
            .sort((a, b) =>
              parseFloat(a.sortOrder) > parseFloat(b.sortOrder)
                ? 1
                : parseFloat(a.sortOrder) < parseFloat(b.sortOrder)
                ? -1
                : 0,
            )
        : [],
  },
})

export default module
