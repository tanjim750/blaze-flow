"""Give every stored price a currency code.

Older rows could hold a project fee or task price with a null currency. Stamp them with the
workspace's billing currency (GBP when the workspace never set one), so a later change of
workspace currency never leaves an amount without a currency. Invoices and payments already
carry a non-null currency (default GBP) and are left untouched.
"""
from django.db import migrations


def backfill(apps, schema_editor):
    Settings = apps.get_model('app', 'WorkspaceBillingSettings')
    Project = apps.get_model('app', 'Project')
    Task = apps.get_model('app', 'Task')
    by_workspace = dict(Settings.objects.values_list('workspace_id', 'currency'))
    for model, amount, currency in ((Project, 'client_fee', 'client_fee_currency'), (Task, 'client_price', 'client_price_currency')):
        rows = model.objects.filter(**{f'{amount}__isnull': False, f'{currency}__isnull': True}).values_list('pk', 'workspace_id')
        for pk, workspace_id in rows.iterator():
            model.objects.filter(pk=pk).update(**{currency: by_workspace.get(workspace_id) or 'GBP'})


class Migration(migrations.Migration):
    dependencies = [('app', '0052_drop_duplicate_fk_indexes_outbox_topic')]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
