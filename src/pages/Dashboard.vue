<script>
import BookmarkIcon from '../assets/icons/bookmark.svg'
import Content from '@/components/Content'
import PublicProfilePreview from '@/components/Dashboard/PublicProfilePreview'
import CreatorProfilePreview from '@/components/Dashboard/CreatorProfilePreview'
import Impersonate from '@/components/Dashboard/Impersonate'
import InviteWidget from '@/components/InviteWidget'
import Loader from '@/components/Loader'
import ManageCollectionsPreview from '@/components/Dashboard/ManageCollectionsPreview'
import MessageSequence from '@/components/MessageSequence'
import ReviewSubmissionsPreview from '@/components/Dashboard/ReviewSubmissionsPreview'
import YourBookSubmissions from '@/components/Dashboard/YourBookSubmissions'

export default {
  components: {
    BookmarkIcon,
    Content,
    PublicProfilePreview,
    CreatorProfilePreview,
    Impersonate,
    InviteWidget,
    Loader,
    ManageCollectionsPreview,
    MessageSequence,
    ReviewSubmissionsPreview,
    YourBookSubmissions,
  },
  data() {
    return {
      shareListCompleted: false,
      inviteMessageCompleted: false,
      submissionFormMessageCompleted: false,
      templates: {
        showEmailTemplates: false,
      },
    }
  },
  computed: {
    bookSubmissions() {
      return this.$store.getters['submissions/books/list']()
    },
    loaded() {
      return this.$store.state.user.user
    },
    username() {
      return this.$store.state.user.user?.profile.name || this.$store.state.user.user?.profile.email
    },
    hasPendingPublicProfile() {
      // if affiliations are set, we know the user completed the PublicProfileForm
      const affiliations = this.$store.state.user.user?.profile.affiliations
      return (
        this.$can('submitBookOrBundle') &&
        (!affiliations ||
          (!affiliations.website &&
            !(
              Object.values(affiliations.selectedEngagementCategory).length > 0 ||
              affiliations.otherEngagementCategory
            )))
      )
    },
  },
  created() {
    // cuz submissions collection is readable only per element for non owners
    // we need to preload them
    const submissions = this.$store.state.user.user.profile.submissions || {}
    const preloads = Object.keys(submissions).map(submissionId => {
      return this.$store.dispatch('submissions/books/loadOne', submissionId)
    })
    Promise.all(preloads)
  },
  methods: {
    openBookmarks() {
      this.$router.push({ name: 'Home', params: { bookmarksOpen: true } })
    },
  },
}
</script>

<template>
  <div class="is-flex is-justify-content-center">
    <div class="is-flex-grow-1 mx-20" style="max-width: 600px; position: relative">
      <!-- page title -->
      <h1 class="title page-title divider-bottom">Your Dashboard</h1>

      <!-- your account -->
      <div class="header-options mr-10">
        <router-link :to="{ name: 'Account' }" style="color: black">Your Account</router-link>
      </div>

      <!-- loader -->
      <div v-if="!loaded" class="has-text-centered" style="margin-top: 20vh">
        <Loader />
      </div>

      <!-- Creator Profile Preview -->
      <section v-if="$iam('creator')" class="section">
        <CreatorProfilePreview />
      </section>

      <section
        class="section"
        v-if="submissionFormMessageCompleted && ($can('review') || $can('manageCollections'))"
      >
        <!-- Review Submissions -->
        <div v-if="$can('review')">
          <h2>Review Submissions</h2>
          <ReviewSubmissionsPreview />
        </div>

        <!-- Manage Collections -->
        <div v-if="$can('manageCollections')" class="mt-20">
          <h2>Manage Collections</h2>
          <ManageCollectionsPreview />
          <div class="mb-30">
            <router-link :to="{ name: 'TagsManager' }">Tags Manager</router-link>
          </div>
        </div>
      </section>

      <!-- Submit Book or Bundle -->
      <section
        v-if="$can('submitBookOrBundle')"
        class="section"
        style="padding-top: 75px; padding-bottom: 75px"
      >
        <!-- Welcome message sequence -->
        <MessageSequence
          ref="submissionFormMessage"
          storageKey="dashboardSubmissionForms"
          @load="submissionFormMessageCompleted = $event.completed"
          @completed="submissionFormMessageCompleted = $event"
        >
          <template>
            <h2 class="field">
              <Content name="instructions/dashboard/welcome/0/title">Welcome!</Content>
            </h2>
            <div class="field">
              <Content name="instructions/dashboard/welcome/0/body">
                As a leader in the industry and a contributor to ATW you have special access to two
                Submission Forms: BOOKS and BUNDLES. Both forms are available for you to use as many
                times as you like and at any time. The world is full of beautiful picture books—we
                want to hear what has captured your heart! To that end we hope that you spread the
                love and include picture books that are not in-house and you have not personally
                worked on.
              </Content>
            </div>
          </template>

          <template>
            <h2 class="field">
              <Content name="instructions/dashboard/welcome/1/title">Curatorial Process</Content>
            </h2>
            <div class="field">
              <Content name="instructions/dashboard/welcome/1/body">
                Our vision is to create a directory that exemplifies beautiful art and innovative
                storytelling. Our mission is to amplify BIPOC voices and create a space for BIPOC
                creators and leaders. To that end we are creating a space dedicated to only BIPOC
                creators. All picture books submitted for consideration need to have both BIPOC
                illustrator AND BIPOC author. We also have a separate ATW Curatorial team consisting
                of BIPOC leaders who is tasked with a final curation of all submissions. This means
                that some of your picture books may not be included in the directory, but know that
                we always welcome more submissions from you. Thank you.
              </Content>
            </div>
          </template>

          <template>
            <p class="field">
              <Content name="instructions/welcome/2/body"
                >When you're ready, click on the BOOK button below to submit a book!</Content
              >
            </p>
          </template>
        </MessageSequence>

        <PublicProfilePreview class="mb-30" />

        <div>
          <h2>
            {{ $can('submitPerson') ? 'Submission Forms' : 'Suggest a book' }}
            <span
              v-if="submissionFormMessageCompleted"
              @click.prevent="$refs.submissionFormMessage.toggle"
              v-tippy="{ content: 'Help' }"
              class="has-text-right"
              style="
                margin-left: 10px;
                font-size: 14px;
                white-space: nowrap;
                cursor: pointer;
                vertical-align: middle;
              "
              ><i class="far fa-question-circle"
            /></span>
          </h2>

          <div class="field is-grouped">
            <div class="control">
              <router-link
                class="button is-outlined is-primary"
                :to="{ name: 'BookSubmissionForm' }"
                >Book</router-link
              >
            </div>
            <div v-if="$can('submitPerson')" class="control">
              <router-link
                class="button is-outlined is-primary"
                :to="{ name: 'PersonSubmissionForm' }"
                >Person</router-link
              >
            </div>
            <!-- <div class="control">
              <router-link class="button is-outlined is-primary" :to="{name:'BundleSubmissionForm'}">Bundle</router-link>
            </div> -->
          </div>
        </div>
      </section>

      <!-- Users -->
      <section v-if="$iam('user')" class="section">
        <MessageSequence
          ref="shareListMessage"
          storageKey="dashboardShareList"
          @load="shareListCompleted = $event.completed"
          @completed="shareListCompleted = $event"
        >
          <template>
            <h2 class="field">
              <Content name="instructions/dashboard/user/title">Create and share list</Content>
            </h2>
            <div class="field">
              Create your own list of books and share them with others! To save a book to your list,
              click on the bookmark icon on the book cover:

              <div class="is-flex is-justify-content-center m-5">
                <div
                  class="has-text-right p-3"
                  style="
                    background-color: rgba(255, 255, 255, 0.333);
                    width: 160px;
                    max-width: 100%;
                    border: solid 1px gray;
                    border-top-width: 0;
                  "
                >
                  <BookmarkIcon />
                </div>
              </div>

              To share your list with others, open your saved books and click:
              <div class="is-flex is-justify-content-center m-5">
                <b @click.prevent="openBookmarks"
                  >SHARE LIST <i class="fa fa-share-square ml-1"
                /></b>
              </div>
            </div>
          </template>
        </MessageSequence>

        <h2>
          Discover books
          <span
            v-if="shareListCompleted"
            @click.prevent="$refs.shareListMessage.toggle"
            v-tippy="{ content: 'Help' }"
            class="has-text-right"
            style="
              margin-left: 10px;
              font-size: 14px;
              white-space: nowrap;
              cursor: pointer;
              vertical-align: middle;
            "
            ><i class="far fa-question-circle"
          /></span>
        </h2>

        <p class="field">
          Browse new releases and classic picture books carefully selected to represent the best
          BIPOC creators in the industry.
        </p>

        <router-link class="button is-outlined is-primary" :to="{ name: 'Home' }"
          >Discover and Share</router-link
        >
      </section>

      <!-- Invite -->
      <!-- Users who cannot submit books (creators) do not have submissionFormMessageCompleted -->
      <section
        v-if="$can('invite') && (submissionFormMessageCompleted || !$can('submitBookOrBundle'))"
        class="section"
      >
        <MessageSequence
          ref="inviteMessage"
          storageKey="dashboardInvite"
          @load="inviteMessageCompleted = $event.completed"
          @completed="inviteMessageCompleted = $event"
        >
          <template>
            <h2 class="field">
              <Content name="instructions/dashboard/invite/title">Other Ways to Contribute</Content>
            </h2>
            <div class="field">
              <Content name="instructions/dashboard/invite/body">
                Also you will see on your Dashboard that there is an INVITE USERS window. This is a
                place where you can easily invite people to use ATW. Just type in the names - emails
                of anyone you think should know about A THOUSAND WORLDS and click send. This is not
                a mailing list, they will receive only one email notification from ATW saying hello
                and letting them know about us. If you are as in love with our mission please
                consider helping us spread the word!
              </Content>
            </div>
          </template>
        </MessageSequence>

        <h2>
          Invite Users
          <span
            v-if="inviteMessageCompleted"
            @click.prevent="$refs.inviteMessage.toggle"
            v-tippy="{ content: 'Help' }"
            class="has-text-right"
            style="
              margin-left: 10px;
              font-size: 14px;
              white-space: nowrap;
              cursor: pointer;
              vertical-align: middle;
            "
            ><i class="far fa-question-circle"
          /></span>
        </h2>

        <InviteWidget ref="invite" />
        <ul class="my-20">
          <li v-if="$can('editEmailTemplates')">
            <router-link :to="{ name: 'EmailTemplates' }">Edit email templates</router-link>
          </li>
          <li v-if="$can('manageInvites')">
            <router-link :to="{ name: 'InvitationManager' }">View invitations</router-link>
          </li>
        </ul>
      </section>

      <!-- Your Book Submissions (non-owner) -->
      <section
        v-if="$can('submitBookOrBundle') && !$iam('owner') && bookSubmissions.length"
        class="section"
      >
        <YourBookSubmissions />
      </section>

      <section v-if="$iam('owner')" class="section">
        <Impersonate />
      </section>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use '@/assets/style/mixins.scss' as *;

.section {
  @include primary(border-bottom-color);
  border-bottom: solid 1px;
  &:last-child {
    border-bottom: none;
  }
}

.page {
  width: 100%;
  // max-width: 720px;
  margin: auto;
  padding: 0.75rem;
}

h2.title {
  font-size: 1.5rem;
}

.header-options {
  display: flex;
  justify-content: center;
}

.bordered-top {
  @include primary(border-top-color);
  padding-top: 2rem;
  margin-top: 2rem;
  border-top: 1px solid;
}

a.button {
  min-width: 200px;
  border-radius: 20px;
}
</style>
