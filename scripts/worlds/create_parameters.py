"""Create the explicitly authored, bounded parameter scaffold for the GLSL trial."""
import json
import math
from pathlib import Path

root = Path('public/worlds/draa-valley')
groups = []
def group(identifier, uniform, rows, fields, limits, constraint):
    groups.append({'id': identifier, 'uniform': uniform, 'fields': fields, 'limits': limits, 'values': rows, 'origin': 'authored_initial_guess', 'constraint': constraint})
globals_rows = [
 [-.8,.18,.35,1.1],[1.,.76,.49,.38],[.34,.39,.44,.009],[.69,.61,.49,.7],
 [.24,.37,.49,3.],[.78,.65,.48,128.],[.16,.23,.20,.5],[.012,7.,19.,.7],
 [.58,.39,.22,.18],[.32,.23,.14,18.],[.48,.32,.22,.055],[1.,.8,.055,.25],
 [.08,.35,.34,.7],[.045,47.,14.,.28],[90.,1.,.88,12.],[1.65,1.35,150.,.0006],
]
global_fields = [
 ['sun.x','sun.elevation','sun.z','sun.intensity'],['sun.red','sun.green','sun.blue','ambient.intensity'],
 ['ambient.red','ambient.green','ambient.blue','fog.density'],['haze.red','haze.green','haze.blue','fog.strength'],
 ['sky.zenith.red','sky.zenith.green','sky.zenith.blue','sky.gradient'],['sky.horizon.red','sky.horizon.green','sky.horizon.blue','sun.discSharpness'],
 ['water.red','water.green','water.blue','water.reflectance'],['water.rippleAmplitude','water.frequencyX','water.frequencyZ','water.speed'],
 ['earth.red','earth.green','earth.blue','earth.grainContrast'],['wetBank.red','wetBank.green','wetBank.blue','earth.grainFrequency'],
 ['rock.red','rock.green','rock.blue','terrain.noiseFrequency'],['channel.halfWidth','channel.bendAmplitude','channel.bendFrequency','channel.secondaryBend'],
 ['water.level','channel.depth','bank.height','bank.transitionWidth'],['terrain.slope','foothill.start','foothill.height','terrain.octaveWeight'],
 ['water.highlightSharpness','exposure','gamma','shadow.softness'],['camera.eyeHeight','camera.focalLength','ray.farDistance','ray.hitTolerance'],
]
for index, (values, fields) in enumerate(zip(globals_rows, global_fields)):
    group(f'world-{index:02}', f'uG[{index}]', [values], fields, [[-2,2],[.001,60],[.001,200],[.00001,200]], 'Global appearance and camera estimates; no physical calibration')
palms = []
for index in range(16):
    side = -1 if index % 2 == 0 else 1
    row = index // 2
    seed = (math.sin(index*31.7+11)*43758.5)%1
    palms.append(([side*(4.3+seed*1.8),12-row*8+seed*2,5.2+seed*1.7,.14+seed*.05], [.3*side,.12,2.6+seed*.6,.5], [.8,.11,9.,seed*6.28]))
for i,field_names in enumerate([
 ['x','z','height','trunkRadius'],['leanX','leanZ','crownRadius','crownRise'],['frondDrop','frondWidth','frondCount','rotation']]):
    group(f'palms-{i}',f'uPalm{chr(65+i)}',[list(p[i]) for p in palms],field_names,[[-40,40],[-70,30],[.03,12],[.01,8]],'Palm framing, crowns and trunk shapes; each instance is an authored placement')
buildings=[]
for i in range(24):
    if i==0:
        buildings.append(([-6.,-44.,2.1,2.1],[9.,0.,.35,.22],[1.,.27,.45,1.6]))
    else:
        side=-1 if i%2 else 1
        row=(i-1)//6
        lane=(i-1)%3
        seed=(math.sin(i*17.17)*43758.5)%1
        buildings.append(([side*(4.8+lane*4.5),-35.-row*5.8-seed*1.5,3.5+seed,3.+seed],[2.2+seed*2.2,(seed-.5)*.16,.22,.18],[.86+seed*.2,.22,.36,1.3+seed*.4]))
for i,fields in enumerate([
 ['x','z','width','depth'],['height','rotation','parapetHeight','parapetThickness'],['colorScale','windowWidth','windowHeight','windowSpacing']]):
    group(f'buildings-{i}',f'uBuilding{chr(65+i)}',[list(b[i]) for b in buildings],fields,[[-45,45],[-70,30],[.05,15],[.03,10]],'Settlement masses and tower; individual buildings and windows remain inferred')
fields=[]
for i in range(16):
    side=-1 if i%2 else 1
    row=i//4;lane=(i//2)%2;seed=(math.sin(i*13.1)*4096)%1
    fields.append(([side*(4.+lane*4.7),-4.-row*6,3.8,4.8],[(seed-.5)*.12,.42,.15,.09+seed*.08],[.20+seed*.08,.27+seed*.07,.085, .3]))
for i,names in enumerate([
 ['x','z','width','depth'],['rotation','bedSpacing','borderWidth','cropHeight'],['red','green','blue','patchiness']]):
    group(f'fields-{i}',f'uField{chr(65+i)}',[list(f[i]) for f in fields],names,[[-40,40],[-60,30],[.01,12],[.01,10]],'Cultivated plots and their separation; internal layout is an authored approximation')
ridges=[]
for i in range(8):
    side=-1 if i%2 else 1;row=i//2;seed=(math.sin(i*5.3)*2311)%1
    ridges.append(([side*(26+row*7),-24-row*18,8+seed*12,12+seed*9],[.6+seed,.2*side,1.2,.7+seed*.5]))
for i,names in enumerate([['x','z','height','spread'],['elongation','rotation','roughness','colorScale']]):
    group(f'ridges-{i}',f'uRidge{chr(65+i)}',[list(r[i]) for r in ridges],names,[[-90,90],[-120,90],[.01,40],[.03,40]],'Background ridge silhouettes and atmospheric depth; unseen terrain is authored')
banks=[]
for i in range(6):banks.append(([15-i*14,1.+.08*math.sin(i),.15*math.sin(i*2),12.],[.04*math.sin(i),.05,.25,.9+i*.025]))
for i,names in enumerate([['z','widthScale','centerOffset','blendRadius'],['heightOffset','edgeErosion','wetMargin','colorScale']]):
    group(f'banks-{i}',f'uBank{chr(65+i)}',[list(b[i]) for b in banks],names,[[-90,30],[.001,10],[-2,5],[.01,30]],'Channel edge and wet/dry transitions along six authored sections')
def bounds(name, group_id):
    if group_id.startswith('world-'):
        table = {'sun.x':[-2,2], 'sun.elevation':[.05,1.5], 'sun.z':[-2,2], 'sun.intensity':[.01,4], 'ambient.intensity':[.01,2], 'fog.density':[.0001,.06], 'fog.strength':[0,1], 'sky.gradient':[.2,8], 'sun.discSharpness':[4,512], 'water.reflectance':[0,.9], 'water.rippleAmplitude':[0,.08], 'water.frequencyX':[.1,40], 'water.frequencyZ':[.1,40], 'water.speed':[0,3], 'earth.grainContrast':[0,.8], 'earth.grainFrequency':[.1,40], 'terrain.noiseFrequency':[.001,.2], 'channel.halfWidth':[.3,4], 'channel.bendAmplitude':[0,4], 'channel.bendFrequency':[.005,.2], 'channel.secondaryBend':[0,2], 'water.level':[-.2,.3], 'channel.depth':[.1,1], 'bank.height':[.1,2], 'bank.transitionWidth':[.1,2], 'terrain.slope':[.001,.08], 'foothill.start':[20,80], 'foothill.height':[1,30], 'terrain.octaveWeight':[.05,.4], 'water.highlightSharpness':[4,256], 'exposure':[.3,2], 'gamma':[.4,1.5], 'shadow.softness':[2,24], 'camera.eyeHeight':[.5,4], 'camera.focalLength':[.5,2.5], 'ray.farDistance':[80,180], 'ray.hitTolerance':[.0002,.002]}
        return table.get(name,[0,1])
    table = {'x':[-70,70], 'z':[-110,25], 'height':[.5,20], 'trunkRadius':[.04,.4], 'leanX':[-1.5,1.5], 'leanZ':[-1.5,1.5], 'crownRadius':[1,5], 'crownRise':[0,1.5], 'frondDrop':[.1,2], 'frondWidth':[.03,.25], 'frondCount':[3,12], 'rotation':[-6.2832,6.2832], 'width':[.5,10], 'depth':[.5,10], 'parapetHeight':[.03,.6], 'parapetThickness':[.03,.4], 'colorScale':[.4,1.4], 'windowWidth':[.05,.7], 'windowHeight':[.05,.8], 'windowSpacing':[.5,3], 'bedSpacing':[.1,1], 'borderWidth':[.03,.5], 'cropHeight':[.02,.3], 'red':[.02,.8], 'green':[.02,.8], 'blue':[.01,.6], 'patchiness':[0,.8], 'spread':[6,30], 'elongation':[.3,2], 'roughness':[0,2], 'widthScale':[.4,1.6], 'centerOffset':[-1,1], 'blendRadius':[6,24], 'heightOffset':[-.1,.3], 'edgeErosion':[0,.2], 'wetMargin':[.02,.7]}
    return table[name]
for g in groups:
    g['limits'] = [bounds(name,g['id']) for name in g['fields']]
    for row in g['values']:
        for value, (low,high) in zip(row,g['limits']):
            assert low <= value <= high, (g['id'],value,low,high)
count=sum(len(row) for g in groups for row in g['values'])
assert count==848
(root/'parameters.json').write_text(json.dumps({'schema':1,'parameterCount':count,'space':'dimensionless authored world units; no reconstructed metric scale','groups':groups},indent=2)+'\n')
print(json.dumps({'parameters':count,'vec4Uniforms':count//4,'groups':len(groups)}))
