<script>
import sortBy from 'lodash/sortBy'
import reverse from 'lodash/reverse'
import debounce from 'lodash/debounce'
import dayjs from 'dayjs'
import Loader from '@/components/Loader'
import PersonDetailLink from '@/components/PersonDetailLink'
import SortableTableHeading from '@/components/SortableTableHeading'
import CoverImage from '@/components/CoverImage'
import { remove as diacritics } from 'diacritics'

/** Generates a sort token that will sort empty strings to the end regardless of sort direction. */
const sortEmptyToEnd = (s, dir) => `${dir === 'asc' && s === '' ? 1 : 0}-${s}`

export default {
  name: 'BundleManager',
  components: {
    Loader,
    PersonDetailLink,
    SortableTableHeading,
    CoverImage,
  },
  data() {
    const sortField = this.$route.query?.sort || 'submitted'
    return {
      search: this.$route.query?.search || '',
      sortConfig: {
        field: sortField,
        dir: this.$route.query?.dir || (sortField === 'submitted' ? 'desc' : 'asc'),
      },
    }
  },

  computed: {
    loaded() {
      return this.$store.state.bundles.loaded
    },

    bundles() {
      // sort bundles by the sort config
      const sort = list => {
        const sorted = sortBy(list, [
          bundle =>
            this.sortConfig.field === 'title'
              ? sortEmptyToEnd(
                  (bundle.title || bundle.role || '').toLowerCase(),
                  this.sortConfig.dir,
                )
              : this.sortConfig.field === 'submitted'
                ? dayjs(bundle.createdAt)
                : this.sortConfig.field === 'updated'
                  ? dayjs(bundle.updatedAt)
                  : (bundle[this.sortConfig.field] || '').toLowerCase(),
          'nameLower',
        ])
        return this.sortConfig.dir === 'desc' ? reverse(sorted) : sorted
      }

      // filter bundles by the active search
      const filter = list =>
        this.search
          ? list.filter(bundle =>
              diacritics([bundle.createdAt, bundle.name, bundle.title, bundle.role].join(' '))
                .toLowerCase()
                .includes(diacritics(this.search.trim()).toLowerCase()),
            )
          : list

      return sort(filter(this.bundlesList))
    },

    bundlesList() {
      return this.$store.getters['bundles/list']().map(bundle => ({
        ...bundle,
        nameLower: bundle.name.toLowerCase(),
      }))
    },
  },

  watch: {
    // update search query param on change
    search: debounce(function (next, prev) {
      this.$router.replace({
        ...this.$route,
        query: {
          ...this.$route.query,
          search: next || undefined,
        },
      })
    }, 200),

    // update sort query param on change
    sortConfig: debounce(function (next, prev) {
      this.$router.replace({
        ...this.$route,
        query: {
          ...this.$route.query,
          sort: next.field,
          dir: next.dir,
        },
      })
    }, 200),
  },

  methods: {
    formatDate(d) {
      return dayjs(d).format('M/D/YYYY hh:mm')
    },

    async remove(id) {
      this.$store.commit('ui/setBusy', true)
      try {
        await this.$store.dispatch('bundles/remove', id)
      } finally {
        this.$store.commit('ui/setBusy', false)
      }
    },
  },
}
</script>

<template>
  <div class="is-flex is-justify-content-center m-20 mb-40">
    <div class="is-flex-grow-1 mx-20" style="max-width: 900px">
      <div class="mb-5">
        <a @click.prevent="$router.back" class="is-uppercase is-primary">&lt; Back</a>
      </div>

      <h1 class="title divider-bottom mb-30">Bundles Manager</h1>

      <div class="mb-30 is-flex is-justify-content-space-between">
        <div>
          <router-link
            class="mr-20"
            :to="{ name: 'TagsManager', query: { active: 'bundles' } }"
            style="color: black; line-height: 2.5"
            >Bundle Tags</router-link
          >
        </div>
        <div class="is-flex is-align-items-center">
          <i class="fas fa-search" style="transform: translateX(23px); z-index: 10; opacity: 0.3" />
          <input v-model="search" class="input" placeholder="Search" style="padding-left: 30px" />
        </div>
      </div>

      <div v-if="!loaded && false" class="has-text-centered" style="margin-top: 20vh">
        <Loader />
      </div>

      <div v-else>
        <div v-if="!bundles.length" class="w-100 my-100 has-text-centered">
          <h2 class="mb-20">
            No {{ search ? 'matching ' : '' }}bundles{{ !search ? ' yet!' : '' }}
          </h2>
          <p v-if="search">
            <a @click.prevent="search = ''" class="button is-rounded is-primary">Reset Search</a>
          </p>
        </div>

        <table v-else class="table w-100">
          <thead>
            <tr>
              <td />
              <SortableTableHeading id="nameLower" v-model="sortConfig">Name</SortableTableHeading>
              <SortableTableHeading id="title" v-model="sortConfig">Title</SortableTableHeading>
              <SortableTableHeading
                id="submitted"
                v-model="sortConfig"
                default="desc"
                class="has-text-right pr-20"
                >Created</SortableTableHeading
              >
              <th class="has-text-right">Delete</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="bundle of bundles" :key="bundle.id" :data-bundle-id="bundle.id">
              <!-- photo -->
              <td>
                <PersonDetailLink :bundle="bundle">
                  <CoverImage
                    :item="bundle"
                    style="width: 125px; min-width: 50px; min-height: auto"
                  />
                </PersonDetailLink>
              </td>

              <!-- name -->
              <td>{{ bundle.name }}</td>

              <!-- title -->
              <td>{{ bundle.title || bundle.role }}</td>

              <!-- submitted -->
              <td class="has-text-right">{{ formatDate(bundle.submitted) }}</td>

              <!-- edit/delete -->
              <td class="has-text-right">
                <div class="field is-grouped is-justify-content-flex-end">
                  <p class="control">
                    <button
                      :disabled="$uiBusy"
                      class="button is-flat"
                      @click.prevent="remove(bundle.id)"
                    >
                      <i class="fas fa-times" />
                    </button>
                  </p>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
