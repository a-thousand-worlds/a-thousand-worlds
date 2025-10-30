<script>
import TagsTable from '@/components/TagsTable'

export default {
  name: 'TagsManagerPage',
  components: {
    TagsTable,
  },
  data() {
    return {
      active: this.$route.query?.active || 'books',
    }
  },
  methods: {
    setActive(value) {
      this.active = value
      this.$router.replace({
        name: this.$route.name,
        query: {
          active: value,
        },
      })
    },
  },
}
</script>

<template>
  <div class="m-20 is-flex is-justify-content-center">
    <div class="is-flex-grow-1 mx-20" style="max-width: 760px">
      <div class="mb-5">
        <a @click.prevent="$router.back" class="is-uppercase is-primary">&lt; Back</a>
      </div>

      <h1 class="title divider-bottom mb-30">Tags Manager</h1>

      <div class="tabs">
        <ul>
          <li :class="{ 'is-active': active === 'books' }">
            <a @click.prevent="setActive('books')">Books</a>
          </li>
          <li :class="{ 'is-active': active === 'people' }">
            <a @click.prevent="setActive('people')">People</a>
          </li>
          <li :class="{ 'is-active': active === 'bundles' }">
            <a @click.prevent="setActive('bundles')">Bundles</a>
          </li>
        </ul>
      </div>

      <TagsTable :type="active" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.is-active {
  pointer-events: none;
}
</style>
