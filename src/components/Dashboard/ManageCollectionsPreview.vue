<script>
import BundlesLayoutIcon from '@/assets/icons/bundles-layout.svg'
import Square from '@/components/Square'

export default {
  components: {
    BundlesLayoutIcon,
    Square,
  },
  computed: {
    bookSubmissions() {
      return Object.values(this.$store.state.books?.data)
    },
    bundleSubmissions() {
      return Object.values(this.$store.state.bundles?.data)
    },
    peopleSubmissions() {
      return Object.values(this.$store.state.people?.data)
    },
  },
}
</script>

<template>
  <div class="manage-collections-preview columns">
    <div class="column">
      <router-link :to="{ name: 'BooksManager' }">
        <Square class="square">
          <h3>Books ({{ bookSubmissions.length }})</h3>
        </Square>
      </router-link>
    </div>
    <div class="column">
      <router-link :to="{ name: 'PeopleManager' }">
        <Square class="square" style="border-radius: 999px">
          <h3>People ({{ Object.keys(peopleSubmissions).length }})</h3>
        </Square>
      </router-link>
    </div>
    <div class="column">
      <router-link :to="{ name: 'BundlesManager' }">
        <Square class="square">
          <BundlesLayoutIcon
            style="position: absolute; opacity: 0.1; width: 90%; height: 100%"
            fill="white"
          />
          <!-- position: relative so text covers the BundlesLayoutIcon -->
          <h3 style="position: relative">Bundles ({{ bundleSubmissions.length }})</h3>
        </Square>
      </router-link>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use 'bulma/sass/utilities';
@use '@/assets/style/mixins.scss' as *;

h3 {
  font-size: 20px;
}

h3:hover {
  color: white;
}

.square {
  @include primary(background-color);
  color: white;
}
</style>

<!-- unscoped css to modify square's hover style -->
<style lang="scss">
.manage-collections-preview .square:hover,
.manage-collections-preview .square h3:hover {
  color: black !important;
}
</style>
