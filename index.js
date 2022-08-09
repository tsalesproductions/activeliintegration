const cors = require('cors');
const express = require('express');
const app = express();
const axios = require('axios');
const { li, clients } = require('./clients.json');
const { json, response } = require('express');
const low = require('lowdb');
FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync('db.json')
const db = low(adapter)
let orders = db.get("orders")

app.use(cors());
app.get('/', async (req, res) => {
    res.send(`salve`)
});

const liController = {
    app_token: null,
    client: null,
    connectionId: null,
    getOffset: (d) => {
        return new Promise(r => {
            axios.get(d)
            .then(function (response) {
                if(response.status === 200){
                    r(response.data);
                }
            }).catch(function (error) {
                console.log(error.response.status+": "+error.response.data);
            }) 
        }); 
    },
    getOrders: async (app_token, client, type) => {
        liController.app_token = app_token;
        liController.client = client;
        liController.connectionId = await activeCampaign.checkConnection(client);

        let ddd = await liController.getOffset(`https://api.awsli.com.br/v1/pedido/search/?format=json&chave_api=${liController.client.token}&chave_aplicacao=${liController.app_token}&situacao_id=${type}&limit=1`);

        axios.get(`https://api.awsli.com.br/v1/pedido/search/?chave_api=${liController.client.token}&chave_aplicacao=${liController.app_token}&situacao_id=${type}&limit=2&offset=${ddd.meta.total_count - 1}`)
        .then(function (response) {
            if(response.status === 200){
                response.data.objects.map(async (item) => {
                    let order = await liController.getOrder(item.resource_uri);

                    let data = {
                        order_id: item.numero,
                        situation_id: type,
                        crated_time: item.data_criacao,
                        modified_time: item.data_modificacao,
                        discount_price: parseFloat(item.valor_desconto.replace(".","")),
                        shipping_price: parseFloat(item.valor_envio.replace(".","")),
                        subtotal_price: parseFloat(item.valor_subtotal.replace(".","")),
                        total_price: parseFloat(item.valor_total.replace(".","")),
                        cliente: {
                            id: order.cliente.id,
                            cpf: order.cliente.cpf,
                            cnpj: order.cliente.cnpj,
                            primeiro_nome: order.cliente.nome.split(" ")[0],
                            segundo_nome: order.cliente.nome.replace(order.cliente.nome.split(" ")[0]+" ",""),
                            email: order.cliente.email,
                            razao_social: order.cliente.razao_social,
                            sexo: order.cliente.sexo,
                            telefone_celular: order.cliente.telefone_celular,
                            telefone_principal: order.cliente.telefone_principal,
                            data_nascimento: order.cliente.data_nascimento,
                            endereco: order.endereco_entrega
                        },
                        cupom: null,
                        data_compra: order.data_criacao,
                        envio: {
                            id: item.situacao.id,
                            forma: `${order.envios[0].forma_envio.nome}${(order.envios[0].forma_envio.tipo ? ' - '+order.envios[0].forma_envio.tipo : '')}`,
                            status: order.situacao.nome,
                            codigo: order.situacao.codigo,
                            final: order.situacao.final
                        },
                        pagamento: {
                            banco: order.pagamentos[0].banco,
                            bandeira: order.pagamentos[0].bandeira,
                            forma: order.pagamentos[0].forma_pagamento.nome,
                            transacao_id: order.pagamentos[0].transacao_id,
                            valor: order.pagamentos[0].valor,
                            valor_pago: order.pagamentos[0].valor_pago,
                            parcelamento: null,
                        },
                        totals: {
                            utm_campaign: order.utm_campaign,
                            valor_desconto: order.valor_desconto,
                            valor_envio: order.valor_envio,
                            valor_subtotal: order.valor_subtotal,
                            valor_total: order.valor_total,
                        },
                        items: order.itens,
                        products: []
                    }

                    let orderList = db.get('orders')
                        .find({ order_id: data.order_id, codigo: data.envio.id, cliente: client.infos.externalid})
                        .value();

                    if(!orderList){
                        db.get('orders')
                        .push({ order_id: data.order_id, codigo: data.envio.id, cliente: client.infos.externalid})
                        .write()

                        if(order.cupom_desconto){ 
                            data.cupom = order.cupom_desconto.codigo
                        }
    
                        if(order.pagamentos[0].parcelamento){ 
                            data.pagamento.parcelamento = {
                                numero_parcelas: order.pagamentos[0].parcelamento.numero_parcelas, 
                                valor_parcelas: order.pagamentos[0].parcelamento.valor_parcela
                            }
                        }
                        
                        let listagem = new Promise((resolve, reject) => {
                            let i = 0;
                            data.items.forEach(async function(item, index, arr){
                                i++;
                                let produto = await(liController.getProduct(item.produto_pai));
                                    // categoria = await(liController.getProduct(produto.categorias[0]));

                                let d = {
                                    externalid: item.id,
                                    name: item.nome,
                                    price: parseFloat(item.preco_subtotal.slice(0, -2).replace(".", "")),
                                    // category: categoria.nome,
                                    quantity: item.quantidade,
                                    sku: item.sku,
                                    imagemUrl: null,
                                    productUrl: produto.url
                                }

                                if(produto.imagem_principall){
                                    d.imagemUrl = produto.imagem_principal.grande;
                                }

                                data.products.push(d);
    
                               if(i == arr.length){
                                   resolve(true);
                               }
                            });
                        });
    
                        listagem.then( async(r) => {
                            /*
                                VERIFICAR PQ NÃO TÁ APARECENDO PREÇO DE FRETE ETC...
                                ADICIONAR NOTA
                            */
    
                            //activeCampaign.optOrder(client, "GET", '');
    
                            let customer = await activeCampaign.ecomAddCustomers(liController.connectionId, client, data).then(async function(c){
                                let order = await activeCampaign.optOrder(client, "GET", '');
                                    order = order.ecomOrders.find(order => order.externalid == data.order_id);
    
                                let last_order_status = await activeCampaign.getCustomFieldsFromClient(client, `api/3/contacts/${c}/fieldValues`);
                                    last_order_status = last_order_status.fieldValues.find(field => field.field == client.fields.last_order_status);
       
                                    if(!order){
                                        activeCampaign.ecomAddOrder(c, client, data, liController.connectionId); 
                                        //activeCampaign.updateCode(client, data, c);
                                    }
                                    // else{
                                    //     if(last_order_status)
                                    //     if(data.envio.id !== last_order_status.value){
                                    //         activeCampaign.updateCode(client, data, c);
                                    //         if(data.envio.id !== type){
                                    //             switch(data.envio.codigo){
                                    //                case "pedido_pago":
                                    //                     //activeCampaign.addNote(data.cliente.email, client, "O pedido foi pago.")
                                    //                 break;
    
                                    //                 case "pedido_enviado":
                                    //                     //activeCampaign.addNote(data.cliente.email, client, "O pedido foi enviado.")
                                    //                 break; 
    
                                    //                 case "pedido_entregue":
                                    //                     //activeCampaign.addNote(data.cliente.email, client, "O pedido foi entregue.")
                                    //                 break; 
    
                                    //                 case "pagamento_devolvido":
                                    //                     //activeCampaign.addNote(data.cliente.email, client, "O pedido foi devolvido")
                                    //                 break; 
    
                                    //                 case "pedido_cancelado":
                                    //                     //activeCampaign.addNote(data.cliente.email, client, "O pedido foi cancelado")
                                    //                 break; 
                                    //             }
                                    //         }
                                    //     }else{
                                    //        console.log("skippando...") 
                                    //     }
                                    // }
                            })
                            
                        })
                    }
                })
            }
        })
        .catch(function (error) {
            console.log(error.response.status+": "+error.response.data);
        })
    },
    getOrder: (api) => {
        return new Promise(r => {
            axios.get(`https://api.awsli.com.br${api}?chave_api=${liController.client.token}&chave_aplicacao=${liController.app_token}`)
            .then(function (response) {
                if(response.status === 200){
                    r(response.data);
                }
            }) 
        });
    },
    getProduct: (api) => {
        return new Promise(r => {
            axios.get(`https://api.awsli.com.br${api}?chave_api=${liController.client.token}&chave_aplicacao=${liController.app_token}`)
            .then(function (response) {
                if(response.status === 200){
                    r(response.data);
                }
            }) 
        });
    }
}

const activeCampaign = {
    createConnection: (client) => {
        return new Promise(r => {
            let contactObject = {
                "connection": {
                    "service": client.infos.service,
                    "externalid": client.infos.externalid,
                    "name": client.infos.name,
                    "logoUrl": client.infos.logoUrl,
                    "linkUrl": client.infos.linkUrl
                }
            };

            axios({
                method: 'post',
                url: client.active_url+'api/3/connections',
                data: contactObject,
                headers: {'Content-Type': 'multipart/form-data', 'Content-Type': 'application/json', 'Api-Token': client.active_token}
            })
            .then(function (response) {
                r(response.data);
            })
            .catch(function (response) {
                r(response.response.status)
            });
        });
    },
    getConnections: (client) => {
        return new Promise(r => {
            axios({
                method: 'get',
                url: client.active_url+'api/3/connections',
                headers: {'Content-Type': 'multipart/form-data', 'Content-Type': 'application/json', 'Api-Token': client.active_token}
            })
            .then(function (response) {
                r(response.data.connections);
            })
            .catch(function (response) {
                r(response.response.status);
            });
        });
    },
    checkConnection: async(client) => {
        let data = await activeCampaign.getConnections(client),
            conId = null;

        if(data.find(service => service.service === client.infos.service) === undefined){
            conId = await activeCampaign.createConnection(client);
            conId = conId.connection.id;
        }else{
            conId = await activeCampaign.getConnections(client);
            conId = conId.find(service => service.service === client.infos.service)
            if(conId !== undefined){
                conId = conId.id;
            }
        }
        return conId;
    },
    addContact: (client, data,id) => {
        let contactObject = {
            "contact": {
                "email": data.cliente.email,
                "firstName": data.cliente.primeiro_nome,
                "lastName": data.cliente.segundo_nome,
                "phone": data.cliente.telefone_celular,
                "fieldValues":[
                    {
                      "field":client.fields.cpf,
                      "value": data.cliente.cpf
                    },
                    {
                        "field":client.fields.cpnj,
                        "value": data.cliente.cnpj
                    },
                    {
                        "field":client.fields.razao_social,
                        "value": data.cliente.razao_social
                    },
                    {
                        "field":client.fields.sexo,
                        "value": data.cliente.sexo
                    },
                    {
                        "field":client.fields.telefone_principal,
                        "value": data.cliente.telefone_principal
                    },
                    {
                        "field":client.fields.data_nascimento,
                        "value": data.cliente.data_nascimento
                    },
                    {
                        "field":client.fields.bairro,
                        "value": data.cliente.endereco.bairro
                    },
                    {
                        "field":client.fields.cidade,
                        "value": data.cliente.endereco.cidade
                    },
                    {
                        "field":client.fields.estado,
                        "value": data.cliente.endereco.estado
                    },
                    {
                        "field":client.fields.pais,
                        "value": data.cliente.endereco.pais
                    },
                    {
                        "field":client.fields.cep,
                        "value": data.cliente.endereco.cep
                    },
                    {
                        "field": client.fields.last_order_status,
                        "value": data.envio.status
                    }
                ]
            }
        };

        axios({
            method: 'PUT',
            url: client.active_url+'api/3/contacts/'+id,
            data: contactObject,
            headers: {'Content-Type': 'application/json', 'Api-Token': client.active_token}
        })
        .then(function (response) {
            //console.log(response.data)
            console.log("Cadastro atualizado")
        })
        .catch(function (response) {
            console.log(response.response)
        });
    },
    updateCode: (client, data,id) => {
        let contactObject = {
            "contact": {
                "email": data.cliente.email,
                "firstName": data.cliente.primeiro_nome,
                "lastName": data.cliente.primeiro_nome,
                "phone": data.cliente.telefone_celular,
                "fieldValues":[
                    {
                      "field":client.fields.last_order_status,
                      "value": data.envio.id
                    }
                ]
            }
        };

        axios({
            method: 'PUT',
            url: client.active_url+'api/3/contacts/'+id,
            data: contactObject,
            headers: {'Content-Type': 'application/json', 'Api-Token': client.active_token}
        })
        .then(function (response) {
            console.log("Status do pedido foi atualizado")
        })
        .catch(function (response) {
            console.log(response.response)
        });
    },
    getCustomFieldsFromClient: (client, api) => {
        return new Promise(r => {
            axios({
                method: 'get',
                url: client.active_url+api,
                headers: {'Content-Type': 'application/json', 'Api-Token': client.active_token}
            })
            .then(function (response) {
                r(response.data)
            })
            .catch(function (response) {
                console.log(response.response.status)
            });
        });
    },
    addNote: (customer, client, message) => {
        let contactObject = {
            "contact": {
                "email": customer,
                "note": {
                    "note": message,
                }
            }
            
        };

        axios({
            method: 'POST',
            url: client.active_url+'api/3/contact/sync',
            data: contactObject,
            headers: {'Content-Type': 'application/json', 'Api-Token': client.active_token}
        })
        .then(function (response) {
            console.log("Nota adicionada")
        })
        .catch(function (response) {
            console.log(response.response.data)
        });
    },
    ecomAddCustomers: (connection, client, data) => {
        return new Promise(r => {
            let Object = {
                "ecomCustomer": {
                    "connectionid": connection,
                    "externalid": data.cliente.id,
                    "email": data.cliente.email,
                    "acceptsMarketing": "1"
                } 
            };

            axios({
                method: 'post',
                url: client.active_url+'api/3/ecomCustomers',
                data: Object,
                headers: {'Content-Type': 'multipart/form-data', 'Content-Type': 'application/json', 'Api-Token': client.active_token}
            })
            .then(async function (response) {
                console.log("cliente cadastrado")
                let d = await activeCampaign.ecomCheckCustomer(client, data);
                activeCampaign.addContact(client, data, d.id);
                r(d.id);
            })
            .catch(async function (response) {
                console.log("cliente já existe")
                let d = await activeCampaign.ecomCheckCustomer(client, data);
                r(d.id);
                activeCampaign.addContact(client, data, d.id)
            });
        });
    },
    ecomCheckCustomer: (client, data) => {
        return new Promise(r => {
            axios({
                method: 'get',
                url: client.active_url+'api/3/contacts',
                headers: {'Content-Type': 'multipart/form-data', 'Content-Type': 'application/json', 'Api-Token': client.active_token}
            })
            .then(function (response) {
                r(response.data.contacts.find(customer => customer.email === data.cliente.email))
            })
            .catch(function (response) {
                console.log(response.response.status)
            });
        });
    },
    ecomAddOrder: (customer, client, data, connectionId) => {
        function applyCoupom(data){
            if(data.cupom){
                let cupom = {
                    "name": data.cupom,
                    "type": "order",
                    "discountAmount": data.discount_price
                }
            return cupom;
            }
        }

        function eachProducts(data){
            let list = [];

            data.products.forEach((item) => {
                list.push({
                    "externalid": item.externalid,
                    "name": item.name,
                    "price": item.price,
                    "quantity": parseInt(item.quantity),
                    "category": item.category,
                    "sku": item.sku,
                    "imageUrl": item.imagemUrl,
                    "productUrl": item.productUrl
                    });
            });

            return list;
        }

        let contactObject = {
            "ecomOrder": {
                "externalid": data.order_id,
                "source": "1",
                "email": data.cliente.email,
                "orderDiscounts": (applyCoupom(data) ? applyCoupom(data): {}),
                "orderProducts": (eachProducts(data) ? eachProducts(data): []),
                "orderUrl": `https://app.lojaintegrada.com.br/painel/pedido/${data.order_id}/detalhar`,
                "externalCreatedDate": data.crated_time,
                "externalUpdatedDate": data.modified_time,
                "shippingMethod": data.envio.forma,
                "totalPrice": data.total_price,
                "shippingAmount": data.shipping_price,
                "taxAmount": 0,
                "discountAmount": data.discount_price,
                "currency": "BRL",
                "orderNumber": data.order_id,
                "connectionid": connectionId,
                "customerid": customer
                }
        };
        axios({
            method: 'POST',
            url: client.active_url+'api/3/ecomOrders',
            data: contactObject,
            headers: {'Content-Type': 'application/json', 'Api-Token': client.active_token}
        })
        .then(function (response) {
            console.log("Ordem Criada");
            //console.log(response.data)
        })
        .catch(function (response) {
            console.log(response.response.data.errors[0].title)
    
        });
    },
    optOrder: (client, method, id) => {
        return new Promise(r => {
            axios({
                method: method,
                url: client.active_url+'api/3/ecomOrders'+id,
                headers: {'Content-Type': 'application/json', 'Api-Token': client.active_token}
            })
            .then(function (response) {
                r(response.data)
            })
            .catch(function (response) {
                console.log(response)
            });
        })
    },
}


app.listen(3000,  () => {
    /*
        pedido_efetuado     = 9
        pedido_pago         = 4
        pedido_enviado      = 11
        pedido_entregue     = 14
        pagamento_devolvido = 7
        pedido_cancelado    = 8
    */

    setInterval(function(){
        liController.getOrders(li.application_token, clients[0], 9);
    }, 60000 * 1)

    setInterval(function(){
        liController.getOrders(li.application_token, clients[0], 4);
    }, 60000 * 4)

    setInterval(function(){
        liController.getOrders(li.application_token, clients[0], 11);
    }, 60000 * 8)

    setInterval(function(){
        liController.getOrders(li.application_token, clients[0], 14);
    }, 60000 * 12)

    setInterval(function(){
        liController.getOrders(li.application_token, clients[0], 7);
    }, 60000 * 12)

    setInterval(function(){
        liController.getOrders(li.application_token, clients[0], 8);
    }, 60000 * 15)
});

//npm start - res.json()