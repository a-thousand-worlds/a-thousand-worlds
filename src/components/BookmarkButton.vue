<script>
import BookmarkIcon from '../assets/icons/bookmark.svg'

export default {
  components: {
    BookmarkIcon,
  },
  props: ['book', 'iconStyle'],
  computed: {
    isMarked() {
      return this.$store.state.user.user?.profile?.bookmarks?.[this.book.id]
    },
  },
  methods: {
    async toggleBookmark() {
      if (!this.$iam('authorized')) {
        this.$router.push({ name: 'Signup' })
      } else {
        this.$store.commit('ui/setBusy', true)
        await this.$store.dispatch('user/toggleBookmark', {
          id: this.book.id,
          type: 'book',
        })
        this.$store.commit('ui/setBusy', false)
      }
    },
  },
}
</script>

<template>
  <div style="cursor: pointer" @click.prevent.stop="toggleBookmark">
    <BookmarkIcon
      :class="{ 'fill-primary': isMarked, 'fill-secondary-hover': !isMarked }"
      :style="iconStyle"
    />
  </div>
</template>
