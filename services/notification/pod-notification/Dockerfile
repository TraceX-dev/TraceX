FROM tracexapp/base-slim:v20261023
WORKDIR /usr/src/app

COPY bundle/bundle.js ./

EXPOSE 8089 
CMD [ "node", "bundle.js" ]
