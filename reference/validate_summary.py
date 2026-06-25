import sys; sys.path.insert(0,'/home/claude')
from validate import load_year
from et_engine import run

def na(v):
    return None if (v is None or (isinstance(v,str) and v.startswith('#'))) else v

def cmp_year(yr):
    cfg,soil,stages,schedule,weather,gold=load_year(yr)
    out=run(cfg,soil,stages,schedule,weather,etr_override=[g['etr'] for g in gold])
    numcols=['gdd','cumgdd','ro','fracint','kcr','etc','dp','depletion','ad']
    maxd={c:0.0 for c in numcols}; na_cascade=0
    for o,g in zip(out,gold):
        for c in numcols:
            a,b=o[c],na(g[c])
            if a is None or b is None:
                if not(a is None and b is None): na_cascade+=1
                continue
            maxd[c]=max(maxd[c],abs(a-b))
    sh=0
    for o,g in zip(out,gold):
        gv=na(g['should'])
        if gv is None or o['depletion'] is None: continue
        if bool(o['should_irrigate'])!=bool(gv): sh+=1
    appd=max(abs((o['applied'] or 0)-(g['applied'] or 0)) for o,g in zip(out,gold))
    worst=max(maxd.values())
    ok = worst<1e-9 and na_cascade==0 and sh==0 and appd<1e-9
    status='PASS' if ok else 'CHECK'
    print('%d  n=%3d  worst|diff|=%.1e  NA-cascade=%d  should-irr-mism=%d  applied|diff|=%.1e  [%s]' % (
        yr,len(out),worst,na_cascade,sh,appd,status))

for yr in [2017,2018,2019,2020,2021,2022,2023]:
    cmp_year(yr)
