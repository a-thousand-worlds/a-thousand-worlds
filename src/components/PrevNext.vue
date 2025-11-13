<script>
import BookDetailLink from '@/components/BookDetailLink'
import PersonDetailLink from '@/components/PersonDetailLink'

export default {
  components: {
    BookDetailLink,
    PersonDetailLink,
  },
  props: {
    item: {
      required: true,
    },
    type: {
      type: String,
      require: true,
      validator: value => ['books', 'bundles', 'people'].indexOf(value) !== -1,
    },
  },
  computed: {
    next() {
      const list = this.$store.getters[`${this.type}/filtered`]
      const pos = list.map(x => x.id).indexOf(this.item?.id)
      return list[pos + 1]
    },
    prev() {
      const list = this.$store.getters[`${this.type}/filtered`]
      const pos = list.map(x => x.id).indexOf(this.item?.id)
      return list[pos - 1]
    },
  },
}
</script>

<template>
  <div class="prev-next pb-0 mb-10">
    <span v-if="prev" style="white-space: nowrap">
      <span v-if="type === 'books'">
        <BookDetailLink
          :book="prev"
          class="is-hidden-tablet button is-rounded is-primary is-uppercase mr-6 mb-10"
          >&lt; Previous Book</BookDetailLink
        >
        <BookDetailLink :book="prev" class="is-hidden-mobile is-uppercase is-primary mr-6 mb-10"
          >&lt; Previous Book</BookDetailLink
        >
      </span>
      <span v-else-if="type === 'people'">
        <PersonDetailLink
          :person="prev"
          class="is-hidden-tablet button is-rounded is-primary is-uppercase mr-6 mb-10"
          >&lt; Previous Person</PersonDetailLink
        >
        <PersonDetailLink :person="prev" class="is-hidden-mobile is-uppercase is-primary mr-6 mb-10"
          >&lt; Previous Person</PersonDetailLink
        >
      </span>
    </span>

    <!-- separating character needed otherwise the two links do not wrap -->
    <span v-if="next" style="visibility: hidden"> | </span>

    <span v-if="next" style="white-space: nowrap">
      <span v-if="type === 'books'">
        <BookDetailLink
          v-if="next"
          :book="next"
          class="is-hidden-tablet button is-rounded is-primary is-uppercase"
          >Next Book &gt;</BookDetailLink
        >
        <BookDetailLink v-if="next" :book="next" class="is-hidden-mobile is-primary is-uppercase"
          >Next Book &gt;</BookDetailLink
        >
      </span>
      <span v-if="type === 'people'">
        <PersonDetailLink
          v-if="next"
          :person="next"
          class="is-hidden-tablet button is-rounded is-primary is-uppercase"
          >Next Person &gt;</PersonDetailLink
        >
        <PersonDetailLink
          v-if="next"
          :person="next"
          class="is-hidden-mobile is-primary is-uppercase"
          >Next Person &gt;</PersonDetailLink
        >
      </span>
    </span>
  </div>
</template>

<style scoped lang="scss">
@import 'bulma/sass/utilities/_all.sass';

.prev-next {
  text-align: center;
  user-select: none;

  @include from($tablet) {
    text-align: right;
  }
}
</style>
