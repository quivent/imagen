"""Publish immutable experiment captures and recipes to the local viewer index."""
import hashlib
import json
from pathlib import Path
import time
from collections import OrderedDict

REPO=Path(__file__).resolve().parents[2]
STORE=REPO/'.runtime/worlds/experiments'


_images = OrderedDict()
_progress = OrderedDict()


def image(path):
    path = Path(path).resolve()
    info = path.stat()
    stamp = (info.st_mtime_ns, info.st_size)
    previous = _images.get(path)
    if previous is not None and previous[0] == stamp:
        _images.move_to_end(path)
        return dict(previous[1])
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    record = {'sha256': sha, 'file': str(path.relative_to(REPO/'.runtime/worlds')), 'url': '/api/world-experiments/image/'+sha+'.png'}
    _images[path] = (stamp, record)
    _images.move_to_end(path)
    while len(_images) > 512:
        _images.popitem(last=False)
    return dict(record)


def candidate_records(directory, rows):
    key = str(directory.resolve())
    records = _progress.setdefault(key, {})
    _progress.move_to_end(key)
    while len(_progress) > 2:
        _progress.popitem(last=False)
    result = []
    for row in rows:
        previous = records.get(row['id'])
        if previous is not None and previous[0] == row:
            result.append(previous[1])
            continue
        record = {**row, 'image': image(directory/row['render'])}
        record.pop('render', None)
        recipe = directory/f"candidate-{row['id']:02}.json"
        if recipe.exists():
            record['recipe'] = json.loads(recipe.read_text())
        records[row['id']] = (dict(row), record)
        result.append(record)
    return result


def publish_method1(directory):
    directory=Path(directory);report=json.loads((directory/'report.json').read_text())
    run_id='method1-'+directory.name
    captures=candidate_records(directory,report.get('candidates',[]))
    experiment={'id':run_id,'experimentId':report.get('experimentId','experiment-1'),'searchSize':report.get('searchSize',256),'objectiveVersion':report.get('objectiveVersion',1),'method':1,'label':'Pixel parameter fitting · '+directory.name,'status':'complete' if report.get('finishedAt') else 'running','source':report['source'],'shaderSha256':report['shaderSha256'],'baseline':{'components':report['baseline'],'image':image(directory/f"baseline-{report.get('searchSize',256)}.png")},'candidates':captures,'search':report.get('search'),'weights':report['weights'],'pixelSpace':report['pixelSpace'],'route':report['route'],'validation':report.get('validation'),'limitations':report.get('limitations',[]),'observedAt':time.time()}
    if (directory/'baseline-512.png').exists():experiment['baseline']['fullImage']=image(directory/'baseline-512.png')
    if (directory/'best-512.png').exists():experiment['best']={'components':report.get('best',{}),'image':image(directory/'best-512.png'),'recipe':json.loads((directory/'candidate.json').read_text())}
    views=[]
    for name in ['forward','lateral','close','return']:
        path=directory/(name+'-512.png')
        if path.exists():views.append({'label':name,'image':image(path)})
    experiment['views']=views
    put(experiment)


def put(experiment):
    STORE.mkdir(parents=True,exist_ok=True)
    # Individual run records avoid concurrent writers replacing other runs.
    path=STORE/(experiment['id']+'.json');temporary=path.with_suffix('.tmp')
    temporary.write_text(json.dumps(experiment,separators=(',',':'))+'\n');temporary.replace(path)


def publish_method2(directory):
    directory=Path(directory);report=json.loads((directory/'report.json').read_text())
    captures=[]
    for row in report.get('candidates',[]):
        recipe=directory/row['parameters']
        record={**row,'control':row.get('label','contour proposal'),'image':image(directory/row['render']),'recipe':json.loads(recipe.read_text())}
        record.pop('parameters',None);record.pop('render',None);captures.append(record)
    experiment={'id':'method2-'+directory.name,'method':2,'label':'Contour constraints · '+directory.name,'status':'complete' if report.get('finishedAt') else 'running','source':report['source'],'shaderSha256':report['shaderSha256'],'baseline':{'components':report['baseline']['components'],'image':image(directory/'baseline.png')},'candidates':captures,'note':'Contour and pixel losses are retained separately; selection cannot regress the baseline pixel objective.','route':report['route'],'observedAt':time.time(),'views':[]}
    if (directory/'candidate.json').exists():
        selected=next((row for row in captures if row['id']==report.get('bestId')),None)
        if selected:experiment['best']={**selected,'recipe':json.loads((directory/'candidate.json').read_text())}
    for name in ['forward','lateral','close','return']:
        if (directory/(name+'-512.png')).exists():experiment['views'].append({'label':name,'image':image(directory/(name+'-512.png'))})
    if (directory/'best-512.png').exists() and experiment.get('best'):experiment['best']['image']=image(directory/'best-512.png')
    if (directory/'baseline-512.png').exists():experiment['baseline']['fullImage']=image(directory/'baseline-512.png')
    put(experiment)
