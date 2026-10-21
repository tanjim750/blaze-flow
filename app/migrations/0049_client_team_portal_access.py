"""Backfill portal access for client teams whose members accepted an invite before
accepting granted workspace access automatically."""
from django.db import migrations


def forwards(apps, schema_editor):
    from app.models import ClientTeam, ClientTeamMember, ClientTeamMemberStatus, ClientTeamStatus
    from app.services.client_teams import ensure_client_team_workspace_access

    team_ids = ClientTeamMember.objects.filter(
        status=ClientTeamMemberStatus.ACTIVE,
    ).values_list('client_team_id', flat=True)
    for team in ClientTeam.objects.filter(id__in=team_ids, status=ClientTeamStatus.ACTIVE).select_related('workspace'):
        ensure_client_team_workspace_access(team)


class Migration(migrations.Migration):
    dependencies = [('app', '0048_direct_uploads')]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
