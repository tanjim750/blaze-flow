from django.core.management.base import BaseCommand, CommandError

from app.models import Workspace
from app.services.operations import workspace_operations_report


class Command(BaseCommand):
    help = 'Print workspace processing/delivery health and optionally fail on critical alerts.'

    def add_arguments(self, parser):
        parser.add_argument('--workspace-id', required=True)
        parser.add_argument('--fail-on-critical', action='store_true')

    def handle(self, *args, **options):
        try:
            workspace = Workspace.objects.get(id=options['workspace_id'])
        except Workspace.DoesNotExist as exc:
            raise CommandError('Workspace not found.') from exc
        report = workspace_operations_report(workspace=workspace)
        self.stdout.write(str(report))
        if options['fail_on_critical'] and report['status'] == 'critical':
            raise CommandError('Critical operational alerts are active.')
