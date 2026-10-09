"""Builds the offline data bundled in the app.
Sources: GEM Global Active Faults (CC BY-SA 4.0), country-state-city dataset (ODbL, from dr5hn)."""
import json, os, sys, math, collections
GEM, CSC, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(f"{OUT}/faults", exist_ok=True); os.makedirs(f"{OUT}/places", exist_ok=True)

def mid(v):
    try:
        p=[x for x in v.strip('()').split(',')]
        return float(p[0]) if p[0] else None
    except Exception: return None

fe=json.load(open(GEM))['features']
tiles=collections.defaultdict(list)
for i,f in enumerate(fe):
    g=f['geometry']
    if not g: continue
    cs=[[round(c[0],4),round(c[1],4)] for c in g['coordinates']]
    pr=f['properties']
    rec=[i, pr.get('name') or '', pr.get('slip_type') or '', mid(pr.get('net_slip_rate','') or ''), [v for c in cs for v in c]]
    lons=[c[0] for c in cs]; lats=[c[1] for c in cs]
    for tx in range(math.floor(min(lons)/5), math.floor(max(lons)/5)+1):
        for ty in range(math.floor(min(lats)/5), math.floor(max(lats)/5)+1):
            tiles[f"{ty*5}_{tx*5}"].append(rec)
for k,v in tiles.items():
    json.dump(v, open(f"{OUT}/faults/{k}.json","w"), separators=(',',':'), ensure_ascii=False)

json.dump(sorted(tiles), open(f"{OUT}/faults/index.json","w"), separators=(',',':'))

co=json.load(open(f"{CSC}/country.json")); st=json.load(open(f"{CSC}/state.json")); ci=json.load(open(f"{CSC}/city.json"))
r=lambda x: round(float(x),4) if x not in (None,'') else None
countries=[[c['isoCode'],c['name'],r(c['latitude']),r(c['longitude'])] for c in co]
json.dump(countries, open(f"{OUT}/countries.json","w"), separators=(',',':'), ensure_ascii=False)
bycs=collections.defaultdict(list)
for c in ci: bycs[(c[1],c[2])].append([c[0],r(c[3]),r(c[4])])
for c in co:
    cc=c['isoCode']; states=[]
    for s in st:
        if s['countryCode']!=cc: continue
        cities=sorted(bycs.get((cc,s['isoCode']),[]), key=lambda x:x[0])
        states.append([s['isoCode'], s['name'], r(s['latitude']), r(s['longitude']), cities])
    states.sort(key=lambda x:x[1])
    json.dump(states, open(f"{OUT}/places/{cc}.json","w"), separators=(',',':'), ensure_ascii=False)
print(len(tiles),'fault tiles,',len(countries),'countries')
