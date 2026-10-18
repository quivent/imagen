"""Deterministic bounded search over named shader control families."""
from itertools import zip_longest

FAMILIES = ['camera', 'lighting', 'materials', 'terrain', 'palms', 'buildings', 'fields']
DEFAULTS = {'objectiveVersion': 2, 'paused': False, 'adaptive': True, 'families': FAMILIES, 'stepFraction': .04,
            'proposals': 32, 'intervalSeconds': 30, 'meaningfulGain': .002}


def validate(value):
    if not isinstance(value, dict) or set(value) != set(DEFAULTS):
        raise ValueError('Invalid algorithm settings')
    if type(value['paused']) is not bool or type(value['adaptive']) is not bool:
        raise ValueError('Switch values must be boolean')
    if type(value['objectiveVersion']) is not int or value['objectiveVersion'] not in (1, 2):
        raise ValueError('Unknown objective version')
    families = value['families']
    if not isinstance(families, list) or not families or len(set(families)) != len(families) or any(item not in FAMILIES for item in families):
        raise ValueError('Choose at least one known control family')
    for key, low, high in [('stepFraction', .001, .25), ('intervalSeconds', 1, 600), ('meaningfulGain', .0001, .1)]:
        if type(value[key]) not in (int, float) or not low <= value[key] <= high:
            raise ValueError('Out of bounds: '+key)
    if type(value['intervalSeconds']) is not int:
        raise ValueError('Interval must be whole seconds')
    if type(value['proposals']) is not int or not 8 <= value['proposals'] <= 128 or value['proposals'] % 2:
        raise ValueError('Proposal count must be an even integer from 8 to 128')
    return value


def controls(parameters, families):
    buckets = {family: [] for family in FAMILIES}
    buckets['camera'] = [('camera.x', None, 0, 0, 30.), ('camera.z', None, 0, 1, 80.),
                         ('camera.yaw', None, 1, 0, 1.2), ('camera.pitch', None, 1, 1, .8)]
    for group in parameters['groups']:
        name = group['id']
        if name.startswith('world-'):
            number = int(name.split('-')[1])
            family = 'lighting' if number <= 5 or number == 14 else 'materials' if number <= 10 else 'camera' if number == 15 else 'terrain'
        else:
            family = name.split('-')[0]
            if family in ['banks', 'ridges']:
                family = 'terrain'
        for row, values in enumerate(group['values']):
            for component, field in enumerate(group['fields']):
                if field in ['ray.farDistance', 'ray.hitTolerance', 'water.speed']:
                    continue
                low, high = group['limits'][component]
                label = field if name.startswith('world-') else f'{name}[{row}].{field}'
                buckets[family].append((label, name, row, component, high-low))
    return [item for items in zip_longest(*(buckets[family] for family in families)) for item in items if item is not None]


def batch(parameters, settings, cycle, plateau=0):
    settings = validate(settings)
    pool = controls(parameters, settings['families'])
    count = settings['proposals']//2
    start = (cycle*count) % len(pool)
    multiplier = 2**min(2, plateau//3) if settings['adaptive'] else 1
    fraction = min(.25, settings['stepFraction']*multiplier)
    selected = [pool[(start+offset) % len(pool)] for offset in range(min(count, len(pool)))]
    return [(*item[:4], item[4]*fraction) for item in selected], len(pool), fraction
