from django.apps import apps
from django.db import connection
from django.test import TestCase


class IndexHygieneTests(TestCase):
    def test_no_meta_index_duplicates_a_foreign_key_index(self):
        dupes = []
        for model in apps.get_app_config('app').get_models():
            for index in model._meta.indexes:
                if len(index.fields) == 1:
                    field = model._meta.get_field(index.fields[0].lstrip('-'))
                    if field.db_index or field.unique or field.primary_key:
                        dupes.append(f'{model._meta.db_table}.{field.name}')
        self.assertEqual(dupes, [])

    def test_outbox_has_topic_aggregate_index(self):
        with connection.cursor() as cursor:
            constraints = connection.introspection.get_constraints(cursor, 'outbox_events')
        cols = [c['columns'] for c in constraints.values() if c['index']]
        self.assertIn(['topic', 'aggregate_id'], cols)
