"""Short guest share links: ``/r/<short_code>`` alongside the long ``?token=`` link.

Adds ``guest_invites.short_code`` (nullable, unique) and ``shared_media_version_id``
(nullable), then gives every existing invite a fresh random code.

Additive only: no row is deleted and no existing column is changed. The only writes are
UPDATEs setting ``short_code`` on invites that have none. Old ``?token=`` links keep working
because ``token_hash`` is untouched. Reverse simply drops the new columns' data via
RemoveField (Django's automatic reverse of AddField).
"""
import secrets
import string

from django.db import migrations, models

ALPHABET = string.ascii_letters + string.digits
LENGTH = 8


def backfill_short_codes(apps, schema_editor):
    GuestInvite = apps.get_model('app', 'GuestInvite')
    used = set(GuestInvite.objects.exclude(short_code__isnull=True).values_list('short_code', flat=True))
    for invite_id in GuestInvite.objects.filter(short_code__isnull=True).values_list('id', flat=True).iterator():
        code = ''.join(secrets.choice(ALPHABET) for _ in range(LENGTH))
        while code in used:
            code = ''.join(secrets.choice(ALPHABET) for _ in range(LENGTH))
        used.add(code)
        GuestInvite.objects.filter(pk=invite_id, short_code__isnull=True).update(short_code=code)


class Migration(migrations.Migration):
    dependencies = [('app', '0062_media_version_per_asset_numbers')]

    operations = [
        migrations.AddField(model_name='guestinvite', name='short_code', field=models.CharField(blank=True, max_length=16, null=True, unique=True)),
        migrations.AddField(model_name='guestinvite', name='shared_media_version_id', field=models.UUIDField(blank=True, null=True)),
        migrations.RunPython(backfill_short_codes, migrations.RunPython.noop),
    ]
