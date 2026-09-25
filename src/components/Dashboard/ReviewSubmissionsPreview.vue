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
      return this.getPending(this.$store.state.submissions.books)
    },
    bundleSubmissions() {
      return this.getPending(this.$store.state.submissions.bundles)
    },
    peopleSubmissions() {
      return this.getPending(this.$store.state.submissions.people)
    },
  },
  methods: {
    /** Gets the pending submissions, or returns null if they are not all loaded. */
    getPending(submissionsState) {
      // state.loaded is set to true as soon as one submission is loaded
      // loadOne may be called before load here
      // to avoid flashing "0" pending submissions, wait until all are loaded
      return submissionsState.loadedAll
        ? Object.values(submissionsState.data || {}).filter(sub => sub?.status === 'pending')
        : null
    },
  },
}
</script>

<template>
  <div class="columns">
    <div class="column">
      <router-link :to="{ name: 'ReviewSubmissions', params: { type: 'books' } }">
        <Square>
          <h3 :style="{ opacity: bookSubmissions?.length > 0 ? null : 0.4 }">
            Books ({{ bookSubmissions ? bookSubmissions.length : '...' }})
          </h3>
        </Square>
      </router-link>
    </div>
    <div class="column">
      <router-link :to="{ name: 'ReviewSubmissions', params: { type: 'people' } }">
        <Square style="border-radius: 999px">
          <h3 :style="{ opacity: peopleSubmissions?.length > 0 ? null : 0.4 }">
            People ({{ peopleSubmissions ? peopleSubmissions.length : '...' }})
          </h3>
        </Square>
      </router-link>
    </div>
    <div class="column" v-if="$hasFeature($features.BUNDLE)">
      <router-link :to="{ name: 'ReviewSubmissions', params: { type: 'bundle' } }">
        <Square>
          <BundlesLayoutIcon
            class="fill-primary"
            style="position: absolute; opacity: 0.1; width: 90%; height: 100%"
          />
          <h3 :style="{ opacity: bundleSubmissions?.length > 0 ? null : 0.4 }">
            Bundles ({{ bundleSubmissions ? bundleSubmissions.length : '...' }})
          </h3>
        </Square>
      </router-link>
    </div>
  </div>
</template>

<style scoped lang="scss">
h3 {
  font-size: 20px;
}
</style>
