from django.contrib.auth.forms import UserChangeForm, UserCreationForm

from .models import User


class BlazeFlowUserCreationForm(UserCreationForm):
    class Meta(UserCreationForm.Meta):
        model = User
        fields = ('email', 'first_name', 'last_name')


class BlazeFlowUserChangeForm(UserChangeForm):
    class Meta(UserChangeForm.Meta):
        model = User
        fields = '__all__'
