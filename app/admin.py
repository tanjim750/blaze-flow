from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .forms import BlazeFlowUserChangeForm, BlazeFlowUserCreationForm
from .models import AIReview, AuditLog, OutboxEvent, SupportTicket, User, UserSubscription, Workspace


@admin.register(User)
class BlazeFlowUserAdmin(UserAdmin):
    add_form = BlazeFlowUserCreationForm
    form = BlazeFlowUserChangeForm
    model = User
    ordering = ('email',)
    list_display = ('email', 'first_name', 'last_name', 'status', 'is_staff')
    list_filter = ('status', 'is_staff', 'is_superuser', 'groups')
    search_fields = ('email', 'first_name', 'last_name')
    fieldsets = (
        (None, {'fields': ('email', 'password')}),
        ('Profile', {'fields': ('first_name', 'last_name', 'avatar_url', 'timezone')}),
        ('Status', {'fields': ('status', 'email_verified_at')}),
        ('Permissions', {'fields': ('is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        ('Dates', {'fields': ('last_login', 'created_at', 'updated_at')}),
    )
    readonly_fields = ('last_login', 'created_at', 'updated_at')
    add_fieldsets = (
        (
            None,
            {
                'classes': ('wide',),
                'fields': ('email', 'first_name', 'last_name', 'password1', 'password2', 'is_staff'),
            },
        ),
    )


class ReadOnlyAdmin(admin.ModelAdmin):
    """Look, don't touch: fixes go through services (and the platform admin), not raw edits."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Workspace)
class WorkspaceAdmin(ReadOnlyAdmin):
    list_display = ('name', 'slug', 'status', 'created_at')
    list_filter = ('status',)
    search_fields = ('name', 'slug', 'id')


@admin.register(UserSubscription)
class UserSubscriptionAdmin(ReadOnlyAdmin):
    list_display = ('user', 'plan', 'status', 'trial_ends_at', 'current_period_end', 'cancel_at_period_end')
    list_filter = ('plan', 'status')
    search_fields = ('user__email', 'provider_subscription_id')
    list_select_related = ('user',)


@admin.register(OutboxEvent)
class OutboxEventAdmin(ReadOnlyAdmin):
    list_display = ('topic', 'status', 'attempts', 'available_at', 'updated_at')
    list_filter = ('status', 'topic')
    search_fields = ('id', 'aggregate_id', 'topic')


@admin.register(AIReview)
class AIReviewAdmin(ReadOnlyAdmin):
    list_display = ('id', 'workspace', 'status', 'stage', 'error_code', 'created_at')
    list_filter = ('status',)
    search_fields = ('id', 'error_code')
    list_select_related = ('workspace',)


@admin.register(AuditLog)
class AuditLogAdmin(ReadOnlyAdmin):
    list_display = ('created_at', 'actor_type', 'actor_user', 'action', 'entity_type', 'workspace')
    list_filter = ('actor_type',)
    search_fields = ('action', 'entity_id', 'request_id', 'actor_user__email')
    list_select_related = ('actor_user', 'workspace')


@admin.register(SupportTicket)
class SupportTicketAdmin(ReadOnlyAdmin):
    list_display = ('number', 'subject', 'status', 'category', 'user', 'created_at')
    list_filter = ('status', 'category', 'is_demo')
    search_fields = ('subject', 'user__email')
    list_select_related = ('user',)
