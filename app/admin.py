from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .forms import BlazeFlowUserChangeForm, BlazeFlowUserCreationForm
from .models import User


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
